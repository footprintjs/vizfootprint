/**
 * resourceProgress.def.test.ts — THE DOORS, when a resource's bytes take time.
 *
 * The carrier's half of the law is pinned beside it
 * (`../source/resourceProgress.test.ts`); this file is the half a host touches:
 * a build and a refresh that TELL it how a large body is going, an overview
 * that says the bytes are arriving while they are (and still carries no
 * payload, at any point in the fetch), a refresh it can CUT OFF, and — the
 * honesty — that a read which did not finish moves nothing at all: no version,
 * no bytes, and yesterday's still readable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { buildDashboard, buildDashboardAsync } from './index.js';
import { httpSource, utf8Bytes } from '../source/index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { Dashboard } from './index.js';
import type { DashboardDef } from './types.js';
import type { ResourceProgress } from '../source/index.js';

const PDB = 'HEADER    COMPLEX (ENZYME/INHIBITOR)              14-NOV-97   1AY7\nATOM      1  N   ILE A   1\n';
/** Long enough that the server can send it in pieces, which is the whole point. */
const BIG = PDB.repeat(40);

const withResources = (resources: unknown): DashboardDef => ({ ...makeDashboardDef(), resources }) as DashboardDef;

describe('a resource whose bytes take time', () => {
  let server: Server;
  let base = '';
  /** What the route answers, and how: whole, in two pieces the test releases, or cut off mid-body. */
  let mode: 'whole' | 'held' | 'truncated' = 'whole';
  let body = PDB;
  let etag = '"v1"';
  /** Set by the /held route once its first piece is out; calling it sends the rest. */
  let release: (() => void) | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/table.json') {
        res.writeHead(200, { 'content-type': 'application/json', etag: '"t1"' });
        res.end(JSON.stringify([{ category: 'Formal', value: 1 }]));
        return;
      }
      if (req.headers['if-none-match'] === etag && mode === 'whole') {
        res.writeHead(304, { etag });
        res.end();
        return;
      }
      if (mode === 'truncated') {
        res.writeHead(200, { etag, 'content-type': 'chemical/x-pdb' });
        res.write(body.slice(0, 40));
        setTimeout(() => res.destroy(), 5); // the connection dies with the body half sent
        return;
      }
      if (mode === 'held') {
        res.writeHead(200, { etag, 'content-type': 'chemical/x-pdb' });
        res.write(body.slice(0, 40));
        release = () => res.end(body.slice(40));
        return;
      }
      res.writeHead(200, { etag, 'content-type': 'chemical/x-pdb' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    base = typeof addr === 'object' && addr !== null ? `http://127.0.0.1:${String(addr.port)}` : '';
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** A dashboard whose one resource is that route. */
  const build = async (onResourceProgress?: (p: ResourceProgress) => void): Promise<Dashboard> =>
    buildDashboardAsync(withResources({ structure: { format: 'text', via: 'http', at: `${base}/1ay7.pdb` } }), {
      sources: [httpSource()],
      ...(onResourceProgress === undefined ? {} : { onResourceProgress }),
    });

  /**
   * Start a refresh, wait until its FIRST report says bytes have landed, and
   * hand back the pending act — the feature observing itself, which is the one
   * deterministic way to be inside the window this packet is about.
   */
  async function refreshInFlight(
    d: Dashboard,
    extra: { readonly signal?: AbortSignal } = {},
  ): Promise<{ readonly pending: ReturnType<Dashboard['refresh']>; readonly reports: readonly ResourceProgress[] }> {
    const reports: ResourceProgress[] = [];
    let arrived: () => void;
    const first = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const pending = d.refresh(['structure'], {
      onResourceProgress: (p) => {
        reports.push(p);
        arrived();
      },
      ...extra,
    });
    await first;
    return { pending, reports };
  }

  it('THE BUILD DOOR tells a host how a declared resource is going — and a build that asks nothing lands exactly the same thing', async () => {
    body = BIG;
    etag = '"big"';
    const reports: ResourceProgress[] = [];
    const told = await build((p) => reports.push(p));
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((p) => p.resource === 'structure')).toBe(true);
    expect(reports.at(-1)!.bytes).toBe(utf8Bytes(BIG)); // the last report is the whole body
    const silent = await build();
    // the two builds hold the same facts and the same bytes: the report is the only difference
    // (`retrievedAt` is when each read happened, which is the one thing that must differ)
    expect({ ...silent.resources.structure, retrievedAt: 'then' }).toEqual({ ...told.resources.structure, retrievedAt: 'then' });
    expect(silent.resource('structure')).toMatchObject({ format: 'text', body: BIG });
  });

  it('THE REFRESH DOOR tells it too, and the overview says the bytes are ARRIVING while they are — carrying no payload at any point', async () => {
    body = PDB;
    etag = '"v1"';
    const d = await build();
    const held = d.resources.structure!;
    const session = d.createSession();

    mode = 'held';
    body = BIG;
    etag = '"v2"';
    const { pending, reports } = await refreshInFlight(d);

    // INSIDE THE WINDOW: the row says it is moving, and every other fact on it is still
    // the bytes this dashboard HOLDS — a partially arrived resource lands no version
    const during = (await session.overview()).resources!.structure!;
    expect(during.state).toBe('arriving');
    expect({ ...during, state: undefined }).toEqual({ ...held, state: undefined });
    expect(d.resources.structure!.state).toBe('arriving');
    // …and NO act can reach the bytes that have arrived: the door still hands out yesterday's
    expect(d.resource('structure')).toMatchObject({ body: PDB });
    // THE LAW ON THE WIRE: the overview carries facts, and a fetch in flight changes nothing about that
    const wire = JSON.stringify(await session.overview());
    expect(wire).not.toContain('HEADER');
    expect(wire).not.toContain('"body"');
    expect(wire).toContain('"state":"arriving"');
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.at(-1)!.bytes).toBeLessThan(utf8Bytes(BIG)); // it really was partway through

    release!();
    const out = await pending;
    mode = 'whole';

    // …and once it is whole: the new version, the new bytes, and the word GONE — the row
    // is key-for-key the shape it has when nothing is in flight
    expect(out.resources!.structure).toMatchObject({ changed: true, from: held.version, to: 'etag:"v2"', bytes: utf8Bytes(BIG) });
    const after = (await session.overview()).resources!.structure!;
    expect('state' in after).toBe(false);
    expect(Object.keys(after)).toEqual(Object.keys(held));
    expect(d.resource('structure')).toMatchObject({ body: BIG });
    expect(reports.at(-1)!.bytes).toBe(utf8Bytes(BIG));
  });

  it('A REFRESH A HOST CUTS OFF mid-stream is `cancelled`, and everything it held STANDS', async () => {
    body = PDB;
    etag = '"v1"';
    mode = 'whole';
    const d = await build();
    const held = d.resources.structure!;

    mode = 'held';
    body = BIG;
    etag = '"v3"';
    const ac = new AbortController();
    const { pending } = await refreshInFlight(d, { signal: ac.signal });
    ac.abort();
    const out = await pending;
    mode = 'whole';
    release?.();

    expect(out.resources!.structure).toMatchObject({ refused: true, reason: 'cancelled' });
    expect((out.resources!.structure as { message: string }).message).toContain('cancelled — the request was aborted');
    // yesterday's bytes, yesterday's version, and no state word left behind
    expect(d.resources.structure).toEqual(held);
    expect(d.resource('structure')).toMatchObject({ body: PDB });
    expect((await d.createSession().overview()).resources!.structure!.state).toBeUndefined();
  });

  it('A BODY THAT DID NOT ARRIVE WHOLE lands NO version — refused by name, with the previous bytes still readable', async () => {
    body = PDB;
    etag = '"v1"';
    mode = 'whole';
    const d = await build();
    const held = d.resources.structure!;

    mode = 'truncated';
    body = BIG;
    etag = '"v4"';
    const reports: ResourceProgress[] = [];
    const out = await d.refresh(['structure'], { onResourceProgress: (p) => reports.push(p) });
    mode = 'whole';

    // it is refused by a name from the closed vocabulary, never described as a shorter resource
    expect(out.resources!.structure).toMatchObject({ refused: true, reason: 'disconnected' });
    // NOTHING MOVED: not the version, not the bytes, not the size on the overview
    expect(d.resources.structure).toEqual(held);
    expect(d.resource('structure')).toMatchObject({ body: PDB });
    expect(d.resources.structure!.bytes).toBe(utf8Bytes(PDB));
    // …and the reports it made are not a version of the answer: they are gone with the read
    expect(reports.length).toBeGreaterThan(0);
    expect(JSON.stringify(await d.createSession().overview())).not.toContain('"state"');
  });

  it('the SIGNAL a host passes reaches a table\'s carrier too: the refresh is cancelled and the rows stand', async () => {
    const def = { ...makeDashboardDef(), data: { data: { source: { format: 'rows' as const, via: 'http' as const, at: `${base}/table.json` } } } } as DashboardDef;
    const d = await buildDashboardAsync(def, { sources: [httpSource()] });
    const out = await d.refresh(['data'], { signal: AbortSignal.abort() });
    expect(out.tables.data).toMatchObject({ refused: true, reason: 'cancelled' });
    expect(d.sources.data!.version).toBe('etag:"t1"');
  });

  it('BYTE IDENTITY at the doors: a refresh that passes nothing answers what a refresh always answered', async () => {
    body = PDB;
    etag = '"v1"';
    mode = 'whole';
    const d = await build();
    const bare = await d.refresh(['structure']);
    const empty = await d.refresh(['structure'], {});
    expect(bare).toEqual({ tables: {}, resources: { structure: { unchanged: true, version: 'etag:"v1"' } } });
    expect(empty).toEqual(bare);
    // …and no state word is ever written by a read that reported nothing
    expect(Object.keys(d.resources.structure!)).toEqual(['format', 'via', 'at', 'version', 'retrievedAt', 'bytes']);
  });

  it('a SYNCHRONOUS dashboard takes the options and honestly reports nothing: an inline payload never arrives', async () => {
    const d = buildDashboard(withResources({ structure: { format: 'text', via: 'inline', at: PDB } }));
    const reports: ResourceProgress[] = [];
    const out = await d.refresh(['structure'], { onResourceProgress: (p) => reports.push(p) });
    expect(out.resources!.structure).toMatchObject({ unchanged: true });
    expect(reports).toEqual([]);
  });
});
