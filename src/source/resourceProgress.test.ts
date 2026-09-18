/**
 * resourceProgress.test.ts — BYTES MAY ARRIVE PROGRESSIVELY, AND A RESOURCE IS
 * NOT LANDED UNTIL IT IS WHOLE.
 *
 * The carrier's half of the law (`./README.md`): what a host is TOLD while a
 * body arrives, what the report may and may not claim, and — the half that
 * carries the honesty — that a body which did not arrive whole lands NOTHING
 * and is refused by name.
 *
 * A real local server for the cases that must be MEASURED rather than imagined
 * (a gzipped body whose declared length counts other bytes; a chunked body with
 * no declaration; a declared one arriving in pieces), and a fake fetch for the
 * pathological ones a server cannot be asked to produce (a stream that closes
 * early, one that errors mid-body, a response with no stream at all).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { httpSource } from './http.js';
import { isResourceRefusal, progressFraction } from './index.js';
import type { HttpSourceOptions } from './http.js';
import type { ResourceBody } from './resource.js';
import type { ResourceProgress, ResourceProgressObserver } from './progress.js';
import type { ResourceFormat, ResourceSnapshot, ResourceSnapshotOptions, SourceUnchanged } from './types.js';

/** A first read never answers "unchanged"; these tests read the body and the version. */
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

/** The body the measured case is about, in miniature: text that compresses hard, so its declared length is nothing like its size. */
const PLAIN = 'HEADER    COMPLEX (ENZYME/INHIBITOR)\n'.repeat(1000);
const GZIPPED = gzipSync(Buffer.from(PLAIN));

// ─────────────────────────────────────────────────────────────────────────────
// A REAL SERVER: the three declarations a progressive read has to tell apart.
// ─────────────────────────────────────────────────────────────────────────────

describe('a real server — the three declarations, and what a report may say about each', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/chunked') {
        // no declaration at all: node frames it `transfer-encoding: chunked`
        res.writeHead(200, { 'content-type': 'chemical/x-pdb' });
        res.write(PLAIN.slice(0, 1000));
        setTimeout(() => res.end(PLAIN.slice(1000)), 5);
        return;
      }
      if (url === '/declared') {
        // a count of the very bytes that arrive, and they arrive in pieces
        res.writeHead(200, { 'content-length': String(Buffer.byteLength(PLAIN)), etag: '"d1"' });
        res.write(PLAIN.slice(0, 1000));
        setTimeout(() => res.end(PLAIN.slice(1000)), 5);
        return;
      }
      if (url === '/gzip') {
        // THE MEASURED TRAP: `content-length` counts the COMPRESSED body, the reader accumulates the DECODED one
        res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': String(GZIPPED.length), 'content-type': 'text/plain' });
        res.end(GZIPPED);
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

  /** One resource read against the real server, with the reports it made. */
  const read = async (
    format: ResourceFormat,
    path: string,
    httpOpts: HttpSourceOptions = {},
    name = 'structure',
  ): Promise<{ readonly snap: Promise<ResourceSnapshot>; readonly reports: readonly ResourceProgress[] }> => {
    const reports: ResourceProgress[] = [];
    const handle = await httpSource(httpOpts).openResource!({ format, via: 'http', at: `${base}${path}` }, { resource: name });
    return { snap: handle.snapshot({ onProgress: (p) => reports.push(p) }).then(landed), reports };
  };

  it('NO DECLARATION: every report carries the bytes so far, "unknown total" is the ABSENCE of a total, and there is no fraction to show', async () => {
    const { snap, reports } = await read('text', '/chunked');
    const body = await snap;
    expect(body.body).toBe(PLAIN);
    expect(reports.length).toBeGreaterThan(1); // it arrived in pieces, and each one was reported
    // bytes so far: a fact, always — monotonic, and the last one is the whole body
    expect(reports.map((p) => p.bytes)).toEqual([...reports.map((p) => p.bytes)].sort((a, b) => a - b));
    expect(reports.at(-1)!.bytes).toBe(Buffer.byteLength(PLAIN));
    for (const p of reports) {
      expect('total' in p).toBe(false); // NOT a zero: the key is not there
      expect(progressFraction(p)).toBeUndefined(); // …and no bar may be drawn from it
      expect(p.resource).toBe('structure');
    }
  });

  it('A TRUSTWORTHY DECLARATION: the total rides every report, the fraction is honest, and the last one is 1', async () => {
    const { snap, reports } = await read('text', '/declared');
    expect((await snap).version).toBe('etag:"d1"');
    const total = Buffer.byteLength(PLAIN);
    for (const p of reports) {
      expect(p.total).toBe(total);
      expect(progressFraction(p)!).toBeLessThanOrEqual(1);
    }
    expect(reports.at(-1)).toEqual({ resource: 'structure', bytes: total, total });
    expect(progressFraction(reports.at(-1)!)).toBe(1);
  });

  it('THE GZIP TRAP, MEASURED: the declaration is smaller than the bytes that arrive, so it is NOT a total and no fraction can exceed 1', async () => {
    const { snap, reports } = await read('text', '/gzip');
    const body = await snap;
    expect(body.body).toBe(PLAIN);
    // the pair the trap is made of, as the wire actually carried it
    expect(GZIPPED.length).toBeLessThan(Buffer.byteLength(PLAIN));
    expect(reports.at(-1)!.bytes).toBe(Buffer.byteLength(PLAIN)); // DECODED bytes, far past the declared
    for (const p of reports) {
      expect(p.total).toBeUndefined(); // the honest answer: unknown
      expect(progressFraction(p)).toBeUndefined(); // …so nothing computes a percentage past 100%
    }
  });

  it('THE GUARD JUDGES THE RIGHT PAIR: the declared length passes the pre-read guard and the DECODED bytes are refused — on both strategies, with the same reason and the same cap', async () => {
    // the declaration (a few hundred compressed bytes) is UNDER the cap, so the pre-read guard
    // passes it; the decoded body is far over, and the arrival check is the one that fires. The
    // tail names the declaration and the encoding — where it used to say "the server declared no length"
    const tail = `(the server declared ${String(GZIPPED.length)} bytes, but the body arrived content-encoding: gzip — that count is not these bytes), the cap is 1000`;
    // the PROGRESSIVE read stops as soon as the cap is crossed, and says that it stopped
    const withReports = await read('text', '/gzip', { maxBytes: 1000 });
    const stopped = await refusalOf(withReports.snap);
    expect(stopped).toMatch(new RegExp(`^too-large: resource "structure" http source ${base}/gzip: too-large — \\d+ UTF-16 units arrived and the read was stopped there `));
    expect(stopped.endsWith(tail)).toBe(true);
    // …and the read that asks nothing — the whole body in one act — measures all of it and refuses in the same tail
    const plainHandle = await httpSource({ maxBytes: 1000 }).openResource!({ format: 'text', via: 'http', at: `${base}/gzip` }, { resource: 'structure' });
    expect(await refusalOf(plainHandle.snapshot())).toBe(`too-large: resource "structure" http source ${base}/gzip: too-large — ${String(PLAIN.length)} UTF-16 units arrived ${tail}`);
  });

  it('a cap over a body with NO declaration keeps the sentence it always had — word for word on the whole read', async () => {
    const plainHandle = await httpSource({ maxBytes: 100 }).openResource!({ format: 'text', via: 'http', at: `${base}/chunked` }, { resource: 'structure' });
    expect(await refusalOf(plainHandle.snapshot())).toBe(
      `too-large: resource "structure" http source ${base}/chunked: too-large — ${String(PLAIN.length)} UTF-16 units arrived (the server declared no length), the cap is 100`,
    );
    // …and the progressive read stops early, with the same reason, the same cap and the same tail
    expect(await refusalOf((await read('text', '/chunked', { maxBytes: 100 })).snap)).toMatch(
      new RegExp(`^too-large: .*: too-large — \\d+ UTF-16 units arrived and the read was stopped there \\(the server declared no length\\), the cap is 100$`),
    );
  });

  it('BYTE IDENTITY: a read that passes no observer and no signal takes the whole body in one act and lands exactly what it always did', async () => {
    const asked = await read('bytes', '/declared', {}, 'logo');
    const told = await asked.snap;
    const plainHandle = await httpSource().openResource!({ format: 'bytes', via: 'http', at: `${base}/declared` }, { resource: 'logo' });
    const silent = landed(await plainHandle.snapshot());
    // the two strategies land the same bytes, the same version and the same shape
    expect(silent.format).toBe('bytes');
    expect([...(silent.body as Uint8Array)]).toEqual([...(told.body as Uint8Array)]);
    expect(silent.version).toBe(told.version);
    expect(Object.keys(silent)).toEqual(Object.keys(told));
    expect(asked.reports.length).toBeGreaterThan(0); // one was told and one was not, and that is the only difference
  });

  it('a MULTI-BYTE character split across chunks decodes to the one string both strategies land', async () => {
    const both = await read('text', '/gzip'); // one gzip frame arrives in several decoded chunks
    const plainHandle = await httpSource().openResource!({ format: 'text', via: 'http', at: `${base}/gzip` }, { resource: 'structure' });
    expect((await both.snap).body).toBe(landed(await plainHandle.snapshot()).body);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A FAKE FETCH: the bodies a server cannot be asked to produce.
// ─────────────────────────────────────────────────────────────────────────────

/** What a fake response is made of: the chunks its body arrives in (`null` = no readable stream at all), its headers, and how it ends. */
interface Fake {
  readonly chunks: readonly (string | Uint8Array)[];
  readonly headers?: Readonly<Record<string, string>>;
  /** Error the stream instead of closing it — a transport fault mid-body. */
  readonly fail?: unknown;
  /** `res.body` is `null`: a response with no readable stream, whose whole body is still there to be read. */
  readonly noStream?: true;
}

const ENCODE = new TextEncoder();
const bytesOf = (chunk: string | Uint8Array): Uint8Array => (typeof chunk === 'string' ? ENCODE.encode(chunk) : chunk);

/**
 * A fetch a test owns: one response, the body arriving in the chunks named, and
 * the three things a test needs to see — which reader was used, how many chunks
 * were actually pulled (so "the transfer was cut off" is observable), and the
 * signal the request was given (so "the transfer was ABORTED" is too).
 */
function fakeFetch(fake: Fake): {
  readonly fetch: typeof fetch;
  readonly usedStream: () => boolean;
  readonly usedWhole: () => boolean;
  readonly delivered: () => number;
  readonly aborted: () => boolean;
} {
  let usedStream = false;
  let usedWhole = false;
  let delivered = 0;
  let signal: AbortSignal | undefined;
  const chunks = fake.chunks;
  const whole = (): Uint8Array => {
    const parts = chunks.map(bytesOf);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out;
  };
  let stream: ReadableStream<Uint8Array> | undefined;
  const streamOf = (): ReadableStream<Uint8Array> => {
    stream ??= new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (delivered < chunks.length) {
          controller.enqueue(bytesOf(chunks[delivered]!));
          delivered += 1;
          return;
        }
        if (fake.fail !== undefined) {
          controller.error(fake.fail);
          return;
        }
        controller.close();
      },
    });
    return stream;
  };
  const res = {
    status: 200,
    ok: true,
    headers: new Headers(fake.headers ?? {}),
    get body(): ReadableStream<Uint8Array> | null {
      usedStream = true;
      return fake.noStream === true ? null : streamOf();
    },
    text: async (): Promise<string> => {
      usedWhole = true;
      return new TextDecoder().decode(whole());
    },
    arrayBuffer: async (): Promise<ArrayBuffer> => {
      usedWhole = true;
      return whole().buffer as ArrayBuffer;
    },
  };
  return {
    fetch: (async (_url: unknown, init: { signal?: AbortSignal }) => {
      signal = init.signal;
      return res;
    }) as unknown as typeof fetch,
    usedStream: () => usedStream,
    usedWhole: () => usedWhole,
    delivered: () => delivered,
    aborted: () => signal?.aborted === true,
  };
}

const AT = 'https://viz.example/1ay7.pdb';

/** One read against a fake response. */
async function readFake(
  fake: Fake,
  opts: ResourceSnapshotOptions & { readonly sinceVersion?: undefined } = {},
  httpOpts: HttpSourceOptions = {},
  format: ResourceFormat = 'text',
): Promise<{ readonly answer: Promise<ResourceSnapshot>; readonly fetched: ReturnType<typeof fakeFetch> }> {
  const fetched = fakeFetch(fake);
  const handle = await httpSource({ fetch: fetched.fetch, ...httpOpts }).openResource!({ format, via: 'http', at: AT }, { resource: 'structure' });
  return { answer: handle.snapshot(opts).then(landed), fetched };
}

/** An observer that keeps every report it was given. */
const collector = (): { readonly onProgress: ResourceProgressObserver; readonly reports: ResourceProgress[] } => {
  const reports: ResourceProgress[] = [];
  return { onProgress: (p) => reports.push(p), reports };
};

describe('WHOLE OR NOTHING — a body that did not arrive whole lands nothing', () => {
  it('a stream that ends EARLY against a total the reader can trust is refused by name, and no body comes back', async () => {
    const seen = collector();
    const { answer, fetched } = await readFake({ chunks: ['HEADER', ' COMPLEX'], headers: { 'content-length': '100', etag: '"v9"' } }, { onProgress: seen.onProgress });
    expect(await refusalOf(answer)).toBe(
      `disconnected: resource "structure" http source ${AT}: disconnected — the body ended after 14 bytes of the 100 the server declared; a resource is not landed until it is whole, so nothing moved`,
    );
    // the reports it made are not retracted — each said what had arrived, which was true
    expect(seen.reports.map((p) => p.bytes)).toEqual([6, 14]);
    expect(seen.reports.at(-1)!.total).toBe(100);
    // …and the transfer was cut off rather than left running
    expect(fetched.aborted()).toBe(true);
  });

  it('with NO trustworthy total the reader claims nothing: a short body it cannot detect lands as the body it was given', async () => {
    // the honest limit of the law's enforcement, stated rather than hidden: nothing here
    // knows the body was meant to be longer, so the bytes that came ARE the resource
    const { answer } = await readFake({ chunks: ['HEADER'], headers: { 'content-length': '100', 'content-encoding': 'gzip' } }, { onProgress: () => undefined });
    expect((await answer).body).toBe('HEADER');
  });

  it('a stream that ERRORS mid-body is the transport\'s own fault, and is never renamed by the cut-off', async () => {
    // the arm that matters: aborting the request here would make `disconnected` read as `timeout`
    const { answer, fetched } = await readFake({ chunks: ['HEADER'], fail: new TypeError('terminated') }, { onProgress: () => undefined });
    expect(await refusalOf(answer)).toBe(`disconnected: resource "structure" http source ${AT}: disconnected — terminated`);
    expect(fetched.aborted()).toBe(false);
  });
});

describe('the cap, asked of what ARRIVES — the transfer stops instead of finishing', () => {
  it('refuses mid-stream, in the same words the whole read would, and stops pulling', async () => {
    const seen = collector();
    const { answer, fetched } = await readFake({ chunks: ['aaaa', 'bbbb', 'cccc', 'dddd'] }, { onProgress: seen.onProgress }, { maxBytes: 6 });
    expect(await refusalOf(answer)).toBe(`too-large: resource "structure" http source ${AT}: too-large — 8 UTF-16 units arrived and the read was stopped there (the server declared no length), the cap is 6`);
    expect(seen.reports).toEqual([{ resource: 'structure', bytes: 4 }]); // the chunk that crossed the cap was never reported as progress
    expect(fetched.delivered()).toBeLessThan(4); // the transfer never ran to the end (a stream pulls one ahead)
    expect(fetched.aborted()).toBe(true);
  });

  it('…and it counts the unit the landing is judged in: bytes for `bytes`', async () => {
    const { answer } = await readFake({ chunks: [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])] }, { onProgress: () => undefined }, { maxBytes: 6 }, 'bytes');
    expect(await refusalOf(answer)).toBe(`too-large: resource "structure" http source ${AT}: too-large — 8 bytes arrived and the read was stopped there (the server declared no length), the cap is 6`);
  });
});

describe('the caller\'s signal, honoured MID-STREAM', () => {
  it('a host that cancels when it sees the first report gets `cancelled`, and no body', async () => {
    const ac = new AbortController();
    const reports: ResourceProgress[] = [];
    const { answer, fetched } = await readFake(
      { chunks: ['HEADER', ' COMPLEX', ' MORE', ' AND', ' MORE', ' STILL'] },
      {
        signal: ac.signal,
        onProgress: (p) => {
          reports.push(p);
          ac.abort(); // the realistic gesture: a reader presses Stop on the progress it was shown
        },
      },
    );
    expect(await refusalOf(answer)).toBe(`cancelled: resource "structure" http source ${AT}: cancelled — the request was aborted`);
    expect(reports).toHaveLength(1);
    expect(fetched.delivered()).toBeLessThan(6);
    expect(fetched.aborted()).toBe(true);
  });
});

describe('a response with no readable stream', () => {
  it('cannot be reported progressively, so it makes the ONE report it can honestly make: the arrival, with the total when there is one', async () => {
    const seen = collector();
    const { answer, fetched } = await readFake({ chunks: ['HEADER'], noStream: true, headers: { 'content-length': '6' } }, { onProgress: seen.onProgress });
    expect((await answer).body).toBe('HEADER');
    expect(fetched.usedWhole()).toBe(true); // the whole body, because there was no other way to take it
    expect(seen.reports).toEqual([{ resource: 'structure', bytes: 6, total: 6 }]);
  });

  it('…and with NO total when the declaration cannot be trusted — the absence, never a zero', async () => {
    const seen = collector();
    const { answer } = await readFake({ chunks: ['HEADER'], noStream: true, headers: { 'content-length': '3', 'content-encoding': 'gzip' } }, { onProgress: seen.onProgress });
    expect((await answer).body).toBe('HEADER');
    expect(seen.reports).toEqual([{ resource: 'structure', bytes: 6 }]);
    expect(progressFraction(seen.reports[0]!)).toBeUndefined();
  });

  it('counts a `bytes` landing in its own bytes, and a text one in UTF-8 — the size, not the units', async () => {
    const seen = collector();
    const { answer } = await readFake({ chunks: [new Uint8Array([1, 2, 3])], noStream: true }, { onProgress: seen.onProgress }, {}, 'bytes');
    expect([...((await answer).body as Uint8Array)]).toEqual([1, 2, 3]);
    expect(seen.reports).toEqual([{ resource: 'structure', bytes: 3 }]);
    const text = collector();
    const emoji = await readFake({ chunks: ['a😀'], noStream: true }, { onProgress: text.onProgress });
    expect((await emoji.answer).body).toBe('a😀');
    expect(text.reports).toEqual([{ resource: 'structure', bytes: 5 }]); // 1 + 4, the bytes it really is
  });
});

describe('a report is not a record', () => {
  it('an observer that THROWS on every report cannot change the bytes, the version or the outcome', async () => {
    const { answer } = await readFake(
      { chunks: ['HEADER', ' COMPLEX'], headers: { etag: '"v1"' } },
      {
        onProgress: () => {
          throw new Error('the host\'s own render blew up');
        },
      },
    );
    const body = await answer;
    expect(body.body).toBe('HEADER COMPLEX');
    expect(body.version).toBe('etag:"v1"');
  });

  it('nothing about a report reaches the landing: a snapshot has the four keys it always had', async () => {
    const { answer } = await readFake({ chunks: ['HEADER'], headers: { etag: '"v1"' } }, { onProgress: () => undefined });
    expect(Object.keys(await answer).sort()).toEqual(['body', 'format', 'retrievedAt', 'version']);
  });
});

describe('the whole-body strategy is untouched', () => {
  it('a read with no observer never touches `res.body` at all', async () => {
    const { answer, fetched } = await readFake({ chunks: ['HEADER'], headers: { etag: '"v1"' } });
    expect((await answer).body).toBe('HEADER');
    expect(fetched.usedWhole()).toBe(true);
    expect(fetched.usedStream()).toBe(false);
    expect(fetched.delivered()).toBe(0);
    expect(fetched.aborted()).toBe(false);
  });

  it('…and a read that carries ONLY a signal is still that read — the strategy turns on the observer alone', async () => {
    const { answer, fetched } = await readFake({ chunks: ['HEADER'] }, { signal: new AbortController().signal });
    expect((await answer).body).toBe('HEADER');
    expect(fetched.usedStream()).toBe(false);
  });
});

describe('the shapes a progressive read hands back', () => {
  it('`bytes` lands one Uint8Array joined from its chunks, in order', async () => {
    const { answer } = await readFake({ chunks: [new Uint8Array([0x89, 0x50]), new Uint8Array([0x4e, 0x47])] }, { onProgress: () => undefined }, {}, 'bytes');
    const body = (await answer).body as Uint8Array;
    expect([...body]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(body).toBeInstanceOf(Uint8Array);
  });

  it('`text` lands the one string, with a character SPLIT across chunks put back together', async () => {
    // 😀 is f0 9f 98 80 — cut between the second and third byte
    const { answer } = await readFake(
      { chunks: [new Uint8Array([0x61, 0xf0, 0x9f]), new Uint8Array([0x98, 0x80, 0x62])] },
      { onProgress: () => undefined },
    );
    const body = await answer;
    expect(body.body).toBe('a😀b');
    expect((body as ResourceBody & { format: 'text' }).format).toBe('text');
  });
});
