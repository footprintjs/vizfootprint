/**
 * A resource is a declared source that is NOT a table (`../source/README.md`):
 * the def door for `resources`, the two builders over it, the FACTS on the
 * overview (never the payload), the version on the record, and the refresh door.
 *
 * The file carrier reads a temp directory this test writes; the http carrier
 * talks to a real local server.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDashboard, buildDashboardAsync, validateDashboardDef, DashboardDefError } from './index.js';
import { fileSource } from '../source/file.js';
import { httpSource, utf8Bytes } from '../source/index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { DashboardDef, SourceAdapter } from './index.js';
import type { ResourceSnapshot, SnapshotOptions, SourceUnchanged } from '../source/index.js';
import type { Cause } from '../cause/index.js';

const PDB = 'HEADER    COMPLEX (ENZYME/INHIBITOR)              14-NOV-97   1AY7\nATOM      1  N   ILE A   1\n';
const USER: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'pick Formal' };

/** The fixture with resources declared beside its data. */
function withResources(resources: unknown): DashboardDef {
  return { ...makeDashboardDef(), resources } as DashboardDef;
}

/** The problems this def raises at the door. */
const problemsOf = (resources: unknown): string[] => validateDashboardDef(withResources(resources));

/** The def error a build raised — never the dashboard, so an assertion reads one shape. */
async function refusedBuild(p: Promise<unknown>): Promise<DashboardDefError> {
  try {
    await p;
    throw new Error('the build was expected to be refused');
  } catch (e) {
    return e as DashboardDefError;
  }
}

describe('the def door — resources', () => {
  it('a good declaration passes, and `resources` is a known top-level key', () => {
    expect(problemsOf({ structure: { format: 'text', via: 'http', at: 'https://x/1ay7.pdb' }, logo: { format: 'bytes', via: 'inline', at: new Uint8Array([1]) } })).toEqual([]);
    expect(validateDashboardDef(makeDashboardDef())).toEqual([]);
    // the firewall still refuses a key nobody declared
    expect(validateDashboardDef({ ...makeDashboardDef(), resourcez: {} } as unknown)).toContain('unknown key "resourcez"');
  });

  it('ONE NAMESPACE PER QUESTION: a resource may not share a name with a declared table', () => {
    // `data` is the fixture's one table
    expect(problemsOf({ data: { format: 'text', via: 'inline', at: 'x' } })).toEqual([
      'resources["data"] is also a declared table — one namespace per question: a resource is a declared source that is NOT a table, so it may not share a name with one',
    ]);
    // …and the collision is judged BEFORE the shape, so one name yields one sentence
    expect(problemsOf({ data: { format: 'csv', via: 'ftp' } })).toHaveLength(1);
  });

  it('a def whose `data` is not a map has no table names to collide with — the resources are still judged', () => {
    const problems = validateDashboardDef({ ...makeDashboardDef(), data: 'nope', resources: { data: { format: 'text', via: 'inline', at: 'x' } } } as unknown);
    expect(problems).toContain('data must be an object mapping table name -> { rows | csv | source }');
    // no name can collide with a table nobody declared, so the resource passes on its own shape
    expect(problems.filter((x) => x.startsWith('resources['))).toEqual([]);
  });

  it('refuses a malformed resource with the sentence for each bookmark', () => {
    expect(problemsOf('structure')).toContain('resources, if present, must be an object mapping name -> { format, via, at?, options? }');
    expect(problemsOf({ s: 'text' })).toContain('resources["s"] must be an object { format, via, at?, options? }');
    expect(problemsOf({ '': { format: 'text', via: 'inline', at: 'x' } })).toEqual(['resources[""]: a resource name must be a non-empty string']);
    expect(problemsOf({ s: { format: 'csv', via: 'inline', at: 'x' } })).toContain('resources["s"].format must be one of bytes|text — a resource lands as bytes, never as rows');
    expect(problemsOf({ s: { format: 'text', via: 'ftp', at: 'x' } })).toContain('resources["s"].via must be one of inline|file|http');
    expect(problemsOf({ s: { format: 'text', via: 'inline' } })).toContain('resources["s"].at must carry the payload when via is inline');
    expect(problemsOf({ s: { format: 'text', via: 'file' } })).toContain('resources["s"].at must be a path or URL string when via is file');
    expect(problemsOf({ s: { format: 'text', via: 'http', at: '' } })).toContain('resources["s"].at must be a path or URL string when via is http');
    expect(problemsOf({ s: { format: 'text', via: 'inline', at: 'x', options: 3 } })).toContain('resources["s"].options, if present, must be an object');
    expect(problemsOf({ s: { format: 'text', via: 'inline', at: 'x', engine: 'wasm' } })).toContain('resources["s"].engine is not a resource key');
    expect(problemsOf({ s: { format: 'text', via: 'inline', at: 'x', options: { a: 1 } } })).toEqual([]);
  });
});

describe('buildDashboard (synchronous) — an inline resource is already here', () => {
  it('lands text and bytes, carries the FACTS, and hands the body through the one door', () => {
    const d = buildDashboard(withResources({ structure: { format: 'text', via: 'inline', at: PDB }, logo: { format: 'bytes', via: 'inline', at: new Uint8Array([0x89, 0x50]) } }));
    expect(d.resources.structure).toMatchObject({ format: 'text', via: 'inline', bytes: utf8Bytes(PDB) });
    // the same `inline:<size>-<hash>` words a table's inline source gets
    expect(d.resources.structure!.version).toMatch(new RegExp(`^inline:${String(utf8Bytes(PDB))}-[0-9a-f]{8}$`));
    expect(typeof d.resources.structure!.retrievedAt).toBe('string');
    expect(d.resources.structure!.at).toBeUndefined(); // an inline payload is never repeated
    expect(d.resources.logo!.bytes).toBe(2);
    // the bytes come through the METHOD, never a field beside the facts
    expect(d.resource('structure')).toMatchObject({ format: 'text', body: PDB });
    expect(d.resource('logo')).toMatchObject({ format: 'bytes' });
    expect([...(d.resource('logo') as { body: Uint8Array }).body]).toEqual([0x89, 0x50]);
    // a name nothing declares answers `undefined` — never an empty body a renderer would draw
    expect(d.resource('nope')).toBeUndefined();
  });

  it('refuses a payload that is not the declared landing, as the def\'s own problem', () => {
    expect(() => buildDashboard(withResources({ logo: { format: 'bytes', via: 'inline', at: 'not bytes' } }))).toThrow(DashboardDefError);
    try {
      buildDashboard(withResources({ logo: { format: 'bytes', via: 'inline', at: 'not bytes' } }));
    } catch (e) {
      expect((e as DashboardDefError).problems).toEqual(['resources["logo"]: `at` must carry a Uint8Array when format is bytes']);
    }
  });

  it('every other via has to be FETCHED, and says which door to use', () => {
    expect(() => buildDashboard(withResources({ structure: { format: 'text', via: 'http', at: 'https://x/a.pdb' } }))).toThrow(
      /resources\["structure"\] declares a resource via http — build it with buildDashboardAsync/,
    );
    expect(() => buildDashboard(withResources({ structure: { format: 'text', via: 'file', at: './a.pdb' } }))).toThrow(
      /resources\["structure"\] declares a resource via file — build it with buildDashboardAsync/,
    );
  });

  it('the runtime a session gets holds the FACTS and not the body — so nothing a session serves can reach it', () => {
    const d = buildDashboard(withResources({ structure: { format: 'text', via: 'inline', at: PDB } }));
    const runtime = (d.createSession() as unknown as { runtime: { resources: unknown } }).runtime;
    expect(JSON.stringify(runtime.resources)).not.toContain('HEADER');
    expect(Object.keys((runtime.resources as Record<string, Record<string, unknown>>)['structure']!)).toEqual(['format', 'via', 'version', 'retrievedAt', 'bytes']);
  });

  it('an inline `bytes` payload stays the author\'s — the freeze walks plain containers only', () => {
    const at = new Uint8Array([1, 2]);
    const d = buildDashboard(withResources({ logo: { format: 'bytes', via: 'inline', at } }));
    expect(Object.isFrozen(at)).toBe(false); // bulk data the author still owns, like a table's `rows`
    expect(Object.isFrozen(d.def.resources!.logo)).toBe(true); // …and the declaration around it is frozen
  });
});

describe('buildDashboardAsync — the carriers, the overview, the record, the refresh', () => {
  let dir = '';
  let pdbPath = '';
  let server: Server;
  let base = '';
  let served = PDB;
  let etag = '"v1"';
  let status = 200;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vizfp-res-def-'));
    pdbPath = join(dir, '1ay7.pdb');
    await writeFile(pdbPath, PDB, 'utf8');
    server = createServer((req, res) => {
      if (status !== 200) {
        res.writeHead(status);
        res.end('no');
        return;
      }
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'chemical/x-pdb', etag });
      res.end(served);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    base = typeof addr === 'object' && addr !== null ? `http://127.0.0.1:${String(addr.port)}` : '';
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const buildHttp = async (): Promise<Awaited<ReturnType<typeof buildDashboardAsync>>> =>
    buildDashboardAsync(withResources({ structure: { format: 'text', via: 'http', at: `${base}/1ay7.pdb` } }), { sources: [httpSource()] });

  it('reads every declared resource with the adapters the host brought, and keeps what each vouched for', async () => {
    const d = await buildDashboardAsync(
      withResources({ structure: { format: 'text', via: 'file', at: pdbPath }, remote: { format: 'bytes', via: 'http', at: `${base}/1ay7.pdb` } }),
      { sources: [fileSource, httpSource()] },
    );
    expect(d.resources.structure).toMatchObject({ format: 'text', via: 'file', at: pdbPath, bytes: utf8Bytes(PDB) });
    expect(d.resources.structure!.version).toMatch(/^mtime:.+;size:\d+$/);
    expect(d.resources.remote).toMatchObject({ format: 'bytes', via: 'http', at: `${base}/1ay7.pdb`, version: 'etag:"v1"' });
    expect(d.resource('structure')).toMatchObject({ format: 'text', body: PDB });
    expect((d.resource('remote') as { body: Uint8Array }).body).toBeInstanceOf(Uint8Array);
  });

  it('a carrier that throws something that is NOT a refusal is still named, at the build door and at the refresh door', async () => {
    // a host adapter may throw anything; neither door re-diagnoses it, and neither loses the sentence.
    // It also stands for a THIRD-PARTY carrier implementing the contract: `snapshot` is declared with
    // `ResourceHandle`'s own two signatures, which is all the port asks of anyone.
    let reads = 0;
    async function rudeSnapshot(options?: SnapshotOptions & { readonly sinceVersion?: undefined }): Promise<ResourceSnapshot>;
    async function rudeSnapshot(options: SnapshotOptions & { readonly sinceVersion: string }): Promise<ResourceSnapshot | SourceUnchanged>;
    async function rudeSnapshot(): Promise<ResourceSnapshot | SourceUnchanged> {
      reads += 1;
      // the FIRST read lands, so the build succeeds and there is something to refresh
      if (reads === 1) return { format: 'text', body: PDB, version: 'v1', retrievedAt: 'now' };
      throw 'a string, not an Error'; // eslint-disable-line no-throw-literal, @typescript-eslint/only-throw-error
    }
    const rude: SourceAdapter = {
      via: 'file',
      // the table door of this fixture is never asked: only its resource door is (a plain comment, not a v8 directive — test files carry no coverage)
      open: () => Promise.reject(new Error('not asked')),
      openResource: () => Promise.resolve({ capabilities: { live: false, pushdown: false } as const, snapshot: rudeSnapshot, close: () => Promise.resolve() }),
    };
    const d = await buildDashboardAsync(withResources({ structure: { format: 'text', via: 'file', at: pdbPath } }), { sources: [rude] });
    expect((await d.refresh(['structure'])).resources!.structure).toEqual({ refused: true, reason: 'no-resource', message: 'a string, not an Error' });
    // …and at the BUILD door, where the same throw is the def's own problem
    reads = 99;
    const failed = await refusedBuild(buildDashboardAsync(withResources({ structure: { format: 'text', via: 'file', at: pdbPath } }), { sources: [rude] }));
    expect(failed.problems).toEqual(['resources["structure"]: a string, not an Error']);
    expect(failed.reason).toBeUndefined(); // nothing typed to carry
  });

  it('a carrier\'s refusal is the def\'s own error, with the typed reason on it', async () => {
    status = 503;
    try {
      await expect(buildHttp()).rejects.toThrow(/resources\["structure"\]: resource "structure" http source .*: unavailable \(503\)/);
      expect((await refusedBuild(buildHttp())).reason).toBe('unavailable');
    } finally {
      status = 200;
    }
    // …and a via no adapter was passed for is refused by name, before anything is opened
    await expect(buildDashboardAsync(withResources({ structure: { format: 'text', via: 'file', at: pdbPath } }))).rejects.toThrow(
      /resources\["structure"\]: resource "structure" file source: no adapter for file was passed/,
    );
  });

  it('the OVERVIEW carries the facts and the size — and NO payload anywhere in it', async () => {
    const d = await buildDashboardAsync(withResources({ structure: { format: 'text', via: 'file', at: pdbPath } }), { sources: [fileSource] });
    const o = await d.createSession().overview();
    expect(o.resources).toEqual({ structure: { format: 'text', via: 'file', at: pdbPath, version: d.resources.structure!.version, retrievedAt: d.resources.structure!.retrievedAt, bytes: utf8Bytes(PDB) } });
    // THE LAW: values never ride the overview, and bytes are not even a value
    const wire = JSON.stringify(o);
    expect(wire).not.toContain('HEADER');
    expect(wire).not.toContain('ATOM');
    expect(wire).not.toContain('"body"');
    expect(wire).toContain('"bytes":');
    // …and the size is what a reader gets instead
    expect(o.resources!.structure!.bytes).toBe(utf8Bytes(PDB));
  });

  it('a COMMIT says which resource versions it was true of, in a map of its own', async () => {
    const d = await buildDashboardAsync(withResources({ structure: { format: 'text', via: 'file', at: pdbPath } }), { sources: [fileSource] });
    const s = d.createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: USER });
    const rec = s.log.records[0]!;
    expect(rec.resources).toEqual({ structure: d.resources.structure!.version });
    // a PARALLEL map: a reader that found it under `data` would think it could ask for rows
    expect(rec.data).toBeUndefined(); // the fixture's table declares inline rows, which never move
    expect(Object.isFrozen(rec.resources)).toBe(true);
  });

  it('a REPLAY carries the resource stamp verbatim — provenance, never re-stamped', async () => {
    const d = await buildDashboardAsync(withResources({ structure: { format: 'text', via: 'file', at: pdbPath } }), { sources: [fileSource] });
    const s = d.createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: USER });
    const original = s.log.records[0]!;
    // replay into a FRESH session whose dashboard holds a different version — the stamp is what it was
    const fresh = d.createSession();
    const res = await fresh.replay([original]);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.landed).toBe(1);
    expect(fresh.log.records[0]!.resources).toEqual(original.resources);
  });

  it('refresh moves a resource\'s version, leaves an unchanged one alone, and leaves yesterday\'s bytes on a refusal', async () => {
    const d = await buildHttp();
    const first = d.resources.structure!.version;

    // UNCHANGED: the server's own 304 on the version held
    expect(await d.refresh()).toEqual({ tables: { data: { refused: true, reason: 'no-source', message: 'data["data"] declares no source — inline rows never move' } }, resources: { structure: { unchanged: true, version: first } } });

    // CHANGED: new bytes, a new validator
    served = `${PDB}ATOM      2  CA  ILE A   1\n`;
    etag = '"v2"';
    const moved = await d.refresh(['structure']);
    expect(moved.resources!.structure).toEqual({ changed: true, from: first, to: 'etag:"v2"', retrievedAt: expect.any(String) as unknown as string, bytes: utf8Bytes(served) });
    expect(moved.tables).toEqual({}); // a call that named only a resource asks no table
    expect(d.resources.structure!.version).toBe('etag:"v2"');
    expect(d.resource('structure')).toMatchObject({ body: served }); // the bytes a host hands out next

    // REFUSED: the version held stands, and so do the bytes
    status = 500;
    try {
      const refused = await d.refresh(['structure']);
      expect(refused.resources!.structure).toMatchObject({ refused: true, reason: 'unavailable' });
      expect(d.resources.structure!.version).toBe('etag:"v2"');
      expect(d.resource('structure')).toMatchObject({ body: served });
    } finally {
      status = 200;
    }

    // the journal kept every answer, resources included
    const asked = d.journal().map((r) => [r.asked, Object.keys(r.resources ?? {})]);
    expect(asked).toEqual([[['data', 'structure'], ['structure']], [['structure'], ['structure']], [['structure'], ['structure']]]);
  });

  it('a name no declaration carries is refused as such, and the sentence names the resources when there are any', async () => {
    const d = await buildHttp();
    const out = await d.refresh(['ghost']);
    expect(out.tables.ghost).toEqual({ refused: true, reason: 'no-source', message: 'no table or resource "ghost" is declared — the tables are data; the resources are structure' });
    expect(out.resources).toBeUndefined(); // nothing about resources was asked
    // …and a def with no resources keeps the sentence it always had
    const plain = await buildDashboardAsync(makeDashboardDef());
    expect((await plain.refresh(['ghost'])).tables.ghost).toEqual({ refused: true, reason: 'no-source', message: 'no table "ghost" is declared — the tables are data' });
  });

  it('a carrier that vouches for the same version after the read moved nothing either', async () => {
    // no etag at all: the hash decides, after the read
    const noValidator = createServer((_req, res) => {
      res.writeHead(200);
      res.end(PDB);
    });
    await new Promise<void>((resolve) => noValidator.listen(0, '127.0.0.1', resolve));
    const addr = noValidator.address();
    const at = `http://127.0.0.1:${String(typeof addr === 'object' && addr !== null ? addr.port : 0)}/x.pdb`;
    try {
      const d = await buildDashboardAsync(withResources({ structure: { format: 'text', via: 'http', at } }), { sources: [httpSource()] });
      const held = d.resources.structure!.version;
      expect(held).toMatch(/^hash:/);
      expect((await d.refresh(['structure'])).resources!.structure).toEqual({ unchanged: true, version: held });
    } finally {
      await new Promise<void>((resolve) => noValidator.close(() => resolve()));
    }
  });

  it('a SYNCHRONOUS dashboard answers unchanged for its inline resources, beside its tables', async () => {
    const d = buildDashboard(withResources({ structure: { format: 'text', via: 'inline', at: PDB } }));
    const version = d.resources.structure!.version;
    expect(await d.refresh()).toEqual({
      tables: { data: { refused: true, reason: 'no-source', message: 'data["data"] declares no source — inline rows never move' } },
      resources: { structure: { unchanged: true, version } },
    });
    expect((await d.refresh(['structure'])).tables).toEqual({});
    expect((await d.refresh(['data'])).resources).toBeUndefined();
    expect((await d.refresh(['ghost'])).tables.ghost).toMatchObject({ reason: 'no-source', message: 'no table or resource "ghost" is declared — the tables are data; the resources are structure' });
    expect(d.journal().at(-1)!.resources).toBeUndefined(); // no resource was asked in that last call
  });
});

describe('a def with no resources is byte-identical to one built before they existed', () => {
  it('the key is ABSENT from the overview, the commit, the refresh result and the journal entry', async () => {
    const d = buildDashboard(makeDashboardDef());
    expect(d.resources).toEqual({});
    const s = d.createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: USER });
    const rec = s.log.records[0]!;
    expect('resources' in rec).toBe(false);
    expect(JSON.stringify(rec)).not.toContain('resources');
    const o = await s.overview();
    expect('resources' in o).toBe(false);
    expect(JSON.stringify(o)).not.toContain('"resources"');
    const refreshed = await d.refresh();
    expect('resources' in refreshed).toBe(false);
    expect('resources' in d.journal()[0]!).toBe(false);
  });

  it('declaring one adds exactly ONE key to the overview and ONE to the commit, and moves nothing else', async () => {
    const plain = await (async (): Promise<{ o: unknown; rec: unknown }> => {
      const d = buildDashboard(makeDashboardDef());
      const s = d.createSession();
      await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: USER });
      return { o: await s.overview(), rec: s.log.records[0]! };
    })();
    const withOne = await (async (): Promise<{ o: unknown; rec: unknown }> => {
      const d = buildDashboard(withResources({ structure: { format: 'text', via: 'inline', at: PDB } }));
      const s = d.createSession();
      await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: USER });
      return { o: await s.overview(), rec: s.log.records[0]! };
    })();
    // the OVERVIEW: one new key, every other byte the same
    const { resources: _res, ...restO } = withOne.o as Record<string, unknown>;
    expect(JSON.stringify(restO)).toBe(JSON.stringify(plain.o));
    // the COMMIT: the same
    const { resources: _recRes, ...restRec } = withOne.rec as Record<string, unknown>;
    expect(JSON.stringify(restRec)).toBe(JSON.stringify(plain.rec));
  });
});
