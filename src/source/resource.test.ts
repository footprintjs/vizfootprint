/**
 * A resource is a declared source that is NOT a table (./README.md): the
 * shapes' own helpers, the three carriers' second door, and the refusal that
 * names a resource rather than a table.
 *
 * The file carrier reads a temp directory this test writes; the http carrier
 * talks to a real local server, as `./http.test.ts` does.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fnv1a,
  fnv1aBytes,
  httpSource,
  inlineResource,
  inlineSource,
  isResourceRefusal,
  isSourceRefusal,
  isUnchanged,
  openResource,
  RESOURCE_FORMATS,
  ResourceRefusal,
  resourceBytes,
  resourceHash,
  resourceInfoOf,
  resourceSnapshotOf,
  resourceVersionsOf,
  resourceWhere,
  utf8Bytes,
} from './index.js';
import { fileSource } from './file.js';
import type { ResourceSnapshot, SourceAdapter, SourceUnchanged } from './types.js';

/** A first read never answers "unchanged"; the tests read the body and the version. */
function landed(s: ResourceSnapshot | SourceUnchanged): ResourceSnapshot {
  if ('unchanged' in s) throw new Error('unexpected unchanged');
  return s;
}

/** The refusal a call made, as `reason: message` — or a sentence saying it was not one. */
const refusalOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'none';
  } catch (e) {
    return isResourceRefusal(e) ? `${e.reason}: ${e.message}` : `not a resource refusal: ${String(e)}`;
  }
};

const PDB = 'HEADER    COMPLEX (ENZYME/INHIBITOR)              14-NOV-97   1AY7\nATOM      1  N   ILE A   1\n';

describe('the resource shapes — size, identity, and the facts row', () => {
  it('there are exactly two landings, and neither of them is rows', () => {
    expect(RESOURCE_FORMATS).toEqual(['bytes', 'text']);
  });

  it('utf8Bytes COUNTS what TextEncoder would allocate — one, two, three and four bytes per character', () => {
    expect(utf8Bytes('')).toBe(0);
    expect(utf8Bytes('abc')).toBe(3); // ASCII
    expect(utf8Bytes('é')).toBe(2); // two-byte
    expect(utf8Bytes('日')).toBe(3); // three-byte
    expect(utf8Bytes('😀')).toBe(4); // a surrogate PAIR is one four-byte character
    expect(utf8Bytes('a😀日é')).toBe(1 + 4 + 3 + 2);
    // and the same answer the allocating spelling gives, over a mixed body
    const mixed = 'HEADER é 日 😀\nATOM';
    expect(utf8Bytes(mixed)).toBe(new TextEncoder().encode(mixed).length);
  });

  it('a LONE surrogate is three bytes, and never eats the character after it', () => {
    const lone = '\ud83d'; // half a pair, which a string may legally hold
    expect(utf8Bytes(lone)).toBe(3);
    expect(utf8Bytes(`${lone}a`)).toBe(4); // the `a` is still counted
    expect(utf8Bytes(`\udc00a`)).toBe(4); // a lone LOW surrogate, same law
  });

  it('resourceBytes and resourceHash answer per format — real bytes for one, UTF-8 for the other', () => {
    const bytes = { format: 'bytes', body: new Uint8Array([1, 2, 3]) } as const;
    const text = { format: 'text', body: 'ab😀' } as const;
    expect(resourceBytes(bytes)).toBe(3);
    expect(resourceBytes(text)).toBe(6);
    expect(resourceHash(bytes)).toBe(fnv1aBytes(new Uint8Array([1, 2, 3])));
    expect(resourceHash(text)).toBe(fnv1a('ab😀'));
    expect(resourceHash(bytes)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('fnv1aBytes tells two bodies apart, and hashes the bytes where they are', () => {
    expect(fnv1aBytes(new Uint8Array([1, 2, 3]))).not.toBe(fnv1aBytes(new Uint8Array([1, 2, 4])));
    expect(fnv1aBytes(new Uint8Array())).toMatch(/^[0-9a-f]{8}$/);
  });

  it('resourceSnapshotOf stamps a read body, and the pair stays narrowed', () => {
    const snap = resourceSnapshotOf({ format: 'text', body: 'x' }, 'v1', 'now');
    expect(snap).toEqual({ format: 'text', body: 'x', version: 'v1', retrievedAt: 'now' });
  });

  it('resourceInfoOf carries the SIZE and the locator — never the payload', () => {
    const snap = resourceSnapshotOf({ format: 'text', body: PDB }, 'etag:"a"', '2026-09-17T00:00:00.000Z');
    const info = resourceInfoOf({ format: 'text', via: 'http', at: 'https://x/1ay7.pdb' }, snap);
    expect(info).toEqual({ format: 'text', via: 'http', at: 'https://x/1ay7.pdb', version: 'etag:"a"', retrievedAt: '2026-09-17T00:00:00.000Z', bytes: utf8Bytes(PDB) });
    expect(JSON.stringify(info)).not.toContain('HEADER');
    // an inline payload is never repeated…
    expect(resourceInfoOf({ format: 'text', via: 'inline', at: PDB }, snap).at).toBeUndefined();
    // …and neither is a locator that is not a string (the def door refuses one; the fold never invents it)
    expect(resourceInfoOf({ format: 'bytes', via: 'file', at: 7 }, snap).at).toBeUndefined();
  });

  it('resourceVersionsOf is the stamp a commit carries — name to version, and {} for none', () => {
    const info = resourceInfoOf({ format: 'text', via: 'inline', at: 'x' }, resourceSnapshotOf({ format: 'text', body: 'x' }, 'v9', 'now'));
    expect(resourceVersionsOf({ structure: info })).toEqual({ structure: 'v9' });
    expect(resourceVersionsOf({})).toEqual({});
  });

  it('resourceWhere reads like a table\'s sentence with the noun changed', () => {
    expect(resourceWhere('structure', 'http', 'https://x/a.pdb')).toBe('resource "structure" http source https://x/a.pdb');
    expect(resourceWhere('structure', 'inline')).toBe('resource "structure" inline source');
  });
});

describe('ResourceRefusal — the same vocabulary, and never a table\'s name in `table`', () => {
  it('names the resource and the via, and carries the typed fields across a wire', () => {
    const r = new ResourceRefusal('unavailable', 'resource "s" http source https://x: unavailable (404)', 's', 'http');
    expect(r.name).toBe('ResourceRefusal');
    expect(r.resource).toBe('s');
    expect(r.via).toBe('http');
    expect(JSON.parse(JSON.stringify(r.toJSON()))).toEqual({ name: 'ResourceRefusal', reason: 'unavailable', message: r.message, resource: 's', via: 'http' });
    // JSON.stringify of the error itself keeps the sentence (`name` lives on the prototype)
    expect(JSON.stringify(r)).toContain('unavailable (404)');
    // a resource refusal has no `table` field at all — the category error the law forbids
    expect('table' in r).toBe(false);
  });

  it('the brand check accepts a clone and a second realm, and refuses everything else — and the two checks never cross', () => {
    const r = new ResourceRefusal('timeout', 'slow', 's', 'http');
    expect(isResourceRefusal(r)).toBe(true);
    expect(isResourceRefusal({ name: 'ResourceRefusal', reason: 'timeout', message: 'slow' })).toBe(true);
    expect(isResourceRefusal({ name: 'ResourceRefusal', reason: 'not-a-reason' })).toBe(false);
    expect(isResourceRefusal({ name: 'SourceRefusal', reason: 'timeout' })).toBe(false);
    expect(isResourceRefusal(null)).toBe(false);
    expect(isResourceRefusal('timeout')).toBe(false);
    // …and a resource refusal is NOT a source refusal: one brand, two names
    expect(isSourceRefusal(r)).toBe(false);
  });
});

describe('the law in the TYPE: only a conditional read may answer `unchanged`', () => {
  it('a first read IS a ResourceSnapshot — the annotations below are the pin, and they fail the typecheck if the overload regresses', async () => {
    const h = await openResource({ format: 'text', via: 'inline', at: 'abc' }, 'r');
    // no union to narrow: `ResourceHandle.snapshot`'s narrow overload says a read holding no
    // version cannot be answered `unchanged`, which is why the build door's `readResource` has
    // no guard against one (`../def/buildDashboard.ts`)
    const first: ResourceSnapshot = await h.snapshot();
    expect(first.body).toBe('abc');
    // …and a read that carries only a signal is still a first read
    const withSignal: ResourceSnapshot = await h.snapshot({ signal: new AbortController().signal });
    expect(withSignal.version).toBe(first.version);
    // only the CONDITIONAL read widens, and only it can come back unchanged
    const conditional: ResourceSnapshot | SourceUnchanged = await h.snapshot({ sinceVersion: first.version });
    expect(isUnchanged(conditional)).toBe(true);
    await h.close();
  });
});

describe('the inline carrier\'s second door', () => {
  it('text lands as a string and bytes as real bytes, each with the `inline:<size>-<hash>` version', async () => {
    const h = await openResource({ format: 'text', via: 'inline', at: PDB }, 'structure');
    expect(h.capabilities).toEqual({ live: false, pushdown: false });
    const snap = landed(await h.snapshot());
    expect(snap.format).toBe('text');
    expect(snap.body).toBe(PDB);
    expect(snap.version).toBe(`inline:${String(utf8Bytes(PDB))}-${fnv1a(PDB)}`);
    expect(typeof snap.retrievedAt).toBe('string');
    await h.close();

    const bytes = landed(await (await openResource({ format: 'bytes', via: 'inline', at: new Uint8Array([7, 8]) }, 'logo')).snapshot());
    expect(bytes.format).toBe('bytes');
    expect(bytes.body).toEqual(new Uint8Array([7, 8]));
    expect(bytes.version).toBe(`inline:2-${fnv1aBytes(new Uint8Array([7, 8]))}`);
  });

  it('a conditional read on the version it already answered moves nothing', async () => {
    const h = await openResource({ format: 'text', via: 'inline', at: 'abc' }, 'r');
    const first = landed(await h.snapshot());
    expect(await h.snapshot({ sinceVersion: first.version })).toEqual({ unchanged: true, version: first.version });
    // …and a version it does not hold reads the payload again
    expect(landed(await h.snapshot({ sinceVersion: 'inline:1-00000000' })).body).toBe('abc');
  });

  it('the payload has to BE the declared landing — never coerced into one', async () => {
    expect(await refusalOf(openResource({ format: 'text', via: 'inline', at: 42 }, 'r'))).toBe('malformed: resource "r" inline source: `at` must carry the text when format is text');
    expect(await refusalOf(openResource({ format: 'bytes', via: 'inline', at: 'not bytes' }, 'r'))).toBe('malformed: resource "r" inline source: `at` must carry a Uint8Array when format is bytes');
    // the landing both builders make answers the same thing as a sentence, never a throw
    expect(inlineResource({ format: 'bytes', via: 'inline', at: 'nope' })).toEqual({ rejected: '`at` must carry a Uint8Array when format is bytes' });
    expect(inlineResource({ format: 'text', via: 'inline', at: 'ok' })).toMatchObject({ format: 'text', body: 'ok' });
  });
});

describe('openResource — two ways to have no carrier, one reason', () => {
  it('a via nothing was passed for, and a carrier that carries tables only', async () => {
    expect(await refusalOf(openResource({ format: 'text', via: 'file', at: './x' }, 'structure'))).toBe(
      'no-adapter: resource "structure" file source: no adapter for file was passed — import the file carrier (the library\'s source/file module) and pass it in `sources`',
    );
    // a carrier written before resources existed is still a valid adapter — and is refused BY NAME
    const tablesOnly: SourceAdapter = { via: 'file', open: inlineSource.open.bind(inlineSource) };
    expect(await refusalOf(openResource({ format: 'text', via: 'file', at: './x' }, 'structure', [tablesOnly]))).toBe(
      'no-adapter: resource "structure" file source: the file adapter this host passed carries tables only — it declares no `openResource`, and a resource is never read as rows',
    );
  });
});

describe('the file carrier\'s second door', () => {
  let dir = '';
  let pdbPath = '';
  let binPath = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vizfp-resource-'));
    pdbPath = join(dir, '1ay7.pdb');
    binPath = join(dir, 'mark.bin');
    await writeFile(pdbPath, PDB, 'utf8');
    await writeFile(binPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads text and bytes, stamps the file system\'s own version, and takes it AFTER the bytes', async () => {
    const text = landed(await (await openResource({ format: 'text', via: 'file', at: pdbPath }, 'structure', [fileSource])).snapshot());
    expect(text.format).toBe('text');
    expect(text.body).toBe(PDB);
    expect(text.version).toMatch(/^mtime:.+;size:\d+$/);
    expect(text.version).toContain(`size:${String(utf8Bytes(PDB))}`);

    const bin = landed(await (await openResource({ format: 'bytes', via: 'file', at: pathToFileURL(binPath).href }, 'logo', [fileSource])).snapshot());
    expect(bin.format).toBe('bytes');
    expect(bin.body).toBeInstanceOf(Uint8Array);
    expect([...bin.body]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('a conditional read answers by a stat — unchanged on the version held, the bytes on any other', async () => {
    const h = await openResource({ format: 'text', via: 'file', at: pdbPath }, 'structure', [fileSource]);
    const first = landed(await h.snapshot());
    expect(await h.snapshot({ sinceVersion: first.version })).toEqual({ unchanged: true, version: first.version });
    expect(landed(await h.snapshot({ sinceVersion: 'mtime:1970-01-01T00:00:00.000Z;size:0' })).body).toBe(PDB);
    await h.close();
  });

  it('every refusal names the RESOURCE: a locator that is neither, a file that is not there, a cancelled read', async () => {
    expect(await refusalOf(openResource({ format: 'text', via: 'file', at: '' }, 'structure', [fileSource]))).toBe('malformed: resource "structure" file source: `at` must be a path or a file URL');
    const missing = join(dir, 'gone.pdb');
    expect(await refusalOf((await openResource({ format: 'text', via: 'file', at: missing }, 'structure', [fileSource])).snapshot())).toBe(
      `unavailable: resource "structure" file source ${missing}: unavailable — ENOENT`,
    );
    const ac = new AbortController();
    ac.abort();
    expect(await refusalOf((await openResource({ format: 'bytes', via: 'file', at: binPath }, 'logo', [fileSource])).snapshot({ signal: ac.signal }))).toBe(
      `cancelled: resource "logo" file source ${binPath}: cancelled — the read was aborted`,
    );
  });
});

describe('the http carrier\'s second door', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/1ay7.pdb') {
        if (req.headers['if-none-match'] === '"pdb-1"') {
          res.writeHead(304, { etag: '"pdb-1"' });
          res.end();
          return;
        }
        // a structure file served as a DOCUMENT: guard 1 has nothing to say about bytes
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: '"pdb-1"' });
        res.end(PDB);
        return;
      }
      if (url === '/mark.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      }
      if (url === '/empty') {
        res.writeHead(200);
        res.end('');
        return;
      }
      if (url === '/big') {
        res.writeHead(200, { 'content-length': '999999999' });
        res.end('xx');
        return;
      }
      if (url === '/nolen') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(Buffer.from([1, 2, 3, 4, 5]));
        return;
      }
      if (url === '/private') {
        res.writeHead(403);
        res.end('no');
        return;
      }
      if (url === '/slow') {
        setTimeout(() => {
          res.writeHead(200);
          res.end('late');
        }, 400);
        return;
      }
      res.writeHead(404);
      res.end('gone');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    base = typeof addr === 'object' && addr !== null ? `http://127.0.0.1:${String(addr.port)}` : '';
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const open = async (format: 'bytes' | 'text', path: string, name = 'structure', opts = {}): Promise<Awaited<ReturnType<NonNullable<SourceAdapter['openResource']>>>> =>
    openResource({ format, via: 'http', at: `${base}${path}` }, name, [httpSource(opts)]);

  it('text lands as text and bytes as a Uint8Array, both with the server\'s own validator as the version', async () => {
    const text = landed(await (await open('text', '/1ay7.pdb')).snapshot());
    expect(text.format).toBe('text');
    expect(text.body).toBe(PDB);
    expect(text.version).toBe('etag:"pdb-1"');

    const png = landed(await (await open('bytes', '/mark.png', 'logo')).snapshot());
    expect(png.format).toBe('bytes');
    expect([...png.body]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.version).toMatch(/^hash:[0-9a-f]{8}$/);
  });

  it('GUARD 1 MEANS NOTHING HERE: a structure file served as text/html is still those bytes', async () => {
    // the very content type that makes a declared `csv` table `malformed` (./README.md, guard 1)
    const snap = landed(await (await open('text', '/1ay7.pdb')).snapshot());
    expect(snap.body).toContain('HEADER');
  });

  it('a conditional read is the server\'s: a 304 moves nothing, and so does a hash that did not move', async () => {
    const h = await open('text', '/1ay7.pdb');
    expect(await h.snapshot({ sinceVersion: 'etag:"pdb-1"' })).toEqual({ unchanged: true, version: 'etag:"pdb-1"' });
    await h.close();
    // a server that vouches for nothing: the hash decides AFTER the read
    const nolen = await open('bytes', '/nolen', 'logo');
    const first = landed(await nolen.snapshot());
    expect(await nolen.snapshot({ sinceVersion: first.version })).toEqual({ unchanged: true, version: first.version });
  });

  it('every way the request can fail has a name, and it names the RESOURCE', async () => {
    expect(await refusalOf(openResource({ format: 'text', via: 'http', at: 'file:///x' }, 'structure', [httpSource()]))).toBe('malformed: resource "structure" http source: `at` must be an http(s) URL');
    expect(await refusalOf((await open('text', '/gone')).snapshot())).toBe(`unavailable: resource "structure" http source ${base}/gone: unavailable (404)`);
    expect(await refusalOf((await open('text', '/private')).snapshot())).toBe(`unauthorized: resource "structure" http source ${base}/private: unauthorized (403)`);
    expect(await refusalOf((await open('text', '/empty')).snapshot())).toBe(`unavailable: resource "structure" http source ${base}/empty: unavailable (200 with an empty body)`);
  });

  it('a size cap refuses by the server\'s declaration before the read, and by what arrived after it', async () => {
    expect(await refusalOf((await open('text', '/big')).snapshot())).toBe(`too-large: resource "structure" http source ${base}/big: too-large — the server declares 999999999 bytes, the cap is 67108864`);
    // no declared length: the diagnostic counts what came, in the unit the format landed in
    expect(await refusalOf((await open('bytes', '/nolen', 'logo', { maxBytes: 2 })).snapshot())).toBe(`too-large: resource "logo" http source ${base}/nolen: too-large — 5 bytes arrived (the server declared no length), the cap is 2`);
    expect(await refusalOf((await open('text', '/1ay7.pdb', 'structure', { maxBytes: 2 })).snapshot())).toBe(
      `too-large: resource "structure" http source ${base}/1ay7.pdb: too-large — ${String(PDB.length)} UTF-16 units arrived (the server declared no length), the cap is 2`,
    );
  });

  it('a runtime with no fetch is a missing CARRIER, not a network fault', async () => {
    const noFetch = httpSource({ fetch: 0 as unknown as typeof fetch });
    expect(await refusalOf((await noFetch.openResource!({ format: 'text', via: 'http', at: `${base}/1ay7.pdb` }, { resource: 'structure' })).snapshot())).toBe(
      `no-adapter: resource "structure" http source ${base}/1ay7.pdb: no-adapter — this runtime has no fetch; pass one in httpSource({ fetch })`,
    );
  });

  it('the time refusals name the resource too: disconnected, timeout, cancelled before and during', async () => {
    const quick = httpSource({ timeoutMs: 100 });
    expect(await refusalOf((await quick.openResource!({ format: 'text', via: 'http', at: 'http://127.0.0.1:1/x' }, { resource: 'structure' })).snapshot())).toMatch(
      /^disconnected: resource "structure" http source http:\/\/127\.0\.0\.1:1\/x: disconnected — /,
    );
    expect(await refusalOf((await open('text', '/slow', 'structure', { timeoutMs: 100 })).snapshot())).toBe(`timeout: resource "structure" http source ${base}/slow: timeout — no answer within 100 ms`);
    const patient = await open('bytes', '/slow', 'logo', { timeoutMs: 5000 });
    const ac = new AbortController();
    const pending = refusalOf(patient.snapshot({ signal: ac.signal }));
    ac.abort();
    expect(await pending).toBe(`cancelled: resource "logo" http source ${base}/slow: cancelled — the request was aborted`);
    expect(await refusalOf(patient.snapshot({ signal: AbortSignal.abort() }))).toBe(`cancelled: resource "logo" http source ${base}/slow: cancelled — the request was aborted before it started`);
  });
});
