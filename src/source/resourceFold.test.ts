/**
 * resourceFold.test.ts — THE CARRIER'S HALF: a computation attaches to bytes
 * as they arrive, and residency is DERIVED from where it attached.
 *
 * A real local server for what has to be MEASURED — a head answer handed to the
 * host while the body is still on the wire, a version that must be
 * byte-identical whether the bytes were kept or not — and a fake fetch for the
 * bodies a server cannot be asked to produce (one that ends short of its
 * declaration, one with no readable stream).
 *
 * The pure core is pinned beside it (`./fold/fold.test.ts`); this file is what
 * a host touches.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { httpSource } from './http.js';
import { foldResource } from './open.js';
import { isResourceRefusal } from './types.js';
import type { HttpSourceOptions } from './http.js';
import type { DeclaredFold, FoldAnswer, ResourceFold } from './fold/types.js';
import type { ResourceFoldOptions, ResourceFoldResult, ResourceFormat, ResourceSnapshot } from './types.js';

const DECODE = new TextDecoder();
const ENCODE = new TextEncoder();

/** The measured body in miniature: a Stockholm header, then sequences. */
const HEADER = '# STOCKHOLM 1.0\n#=GF AC   PF00545.26\n#=GF SQ   3982\n';
const SEQS = 'UniRef/1-9        ACDEFGHIK\nUniRef/2-9        ACDEFGHIL\n'.repeat(8);
const BODY = `${HEADER}${SEQS}//\n`;

/** `head` — the accession and the declared depth, out of the first 48 bytes. */
const accession: ResourceFold<string, string | undefined> = {
  name: 'accession',
  at: 'head',
  headBytes: 48,
  start: () => '',
  take: (_seen, head) => DECODE.decode(head),
  finish: (text) => /#=GF AC\s+(\S+)/.exec(text)?.[1],
};

/** `incremental` — lines seen so far, which later bytes can only add to. */
const seenSoFar: ResourceFold<number, number> = {
  name: 'lines',
  at: 'incremental',
  start: () => 0,
  take: (n, chunk) => n + chunk.reduce((seen, byte) => (byte === 0x0a ? seen + 1 : seen), 0),
  finish: (n) => n,
};

/** `whole` — a digest of every byte, which is not an answer until there are no more. */
const total: ResourceFold<number, number> = {
  name: 'bytes',
  at: 'whole',
  start: () => 0,
  take: (n, chunk) => n + chunk.byteLength,
  finish: (n) => n,
};

/** The refusal a call made, as `reason: message` — or a sentence saying it was not one. */
const refusalOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'none';
  } catch (e) {
    return isResourceRefusal(e) ? `${e.reason}: ${e.message}` : `not a resource refusal: ${String(e)}`;
  }
};

/** A first read never answers "unchanged". */
function landed(s: ResourceSnapshot | { readonly unchanged: true }): ResourceSnapshot {
  if ('unchanged' in s) throw new Error('unexpected unchanged');
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// A REAL SERVER — what has to be measured rather than imagined.
// ─────────────────────────────────────────────────────────────────────────────

describe('a real server — an answer before the data, and a version residency cannot move', () => {
  let server: Server;
  let base = '';
  /** Set by /held once its header is out; calling it sends the rest. */
  let release: (() => void) | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/held') {
        // the header arrives, and the 169 MB body's miniature stand-in waits
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write(HEADER);
        release = () => res.end(`${SEQS}//\n`);
        return;
      }
      if (url === '/declared') {
        res.writeHead(200, { 'content-length': String(Buffer.byteLength(BODY)), 'content-type': 'text/plain' });
        res.write(BODY.slice(0, 40));
        setTimeout(() => res.end(BODY.slice(40)), 5);
        return;
      }
      // a server that vouches for NOTHING, so the version is a hash of the bytes — which is
      // the case the folded hash has to get byte-identically right
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(BODY);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    base = typeof addr === 'object' && addr !== null ? `http://127.0.0.1:${String(addr.port)}` : '';
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** One fold read against the real server, with the answers it handed over as it went. */
  const foldRead = async (
    folds: readonly DeclaredFold[],
    path = '/plain',
    format: ResourceFormat = 'text',
    httpOpts: HttpSourceOptions = {},
    extra: ResourceFoldOptions = {},
  ): Promise<{ readonly result: Promise<ResourceFoldResult>; readonly told: readonly FoldAnswer[] }> => {
    const told: FoldAnswer[] = [];
    const handle = await httpSource(httpOpts).openResource!({ format, via: 'http', at: `${base}${path}` }, { resource: 'alignment' });
    return { result: handle.fold!(folds, { onFoldValue: (a) => told.push(a), ...extra }), told };
  };

  it('A HEAD ANSWER REACHES THE HOST WHILE THE BYTES ARE STILL ARRIVING — the provenance is known before the data is', async () => {
    let pending: Promise<ResourceFoldResult> | undefined;
    let first: FoldAnswer | undefined;
    const arrived = new Promise<void>((resolve) => {
      const handle = httpSource()
        .openResource!({ format: 'text', via: 'http', at: `${base}/held` }, { resource: 'alignment' })
        .then((h) =>
          h.fold!([accession, seenSoFar, total], {
            onFoldValue: (answer) => {
              first ??= answer;
              resolve();
            },
          }),
        );
      pending = handle;
    });
    await arrived;
    // the accession, over the first 48 bytes, with the rest of the body still on the wire
    expect(first).toEqual({ resource: 'alignment', fold: 'accession', at: 'head', bytes: 48, value: 'PF00545.26' });
    let settled = false;
    void pending!.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // the read has NOT finished: this is an answer before the data
    release!();
    const result = await pending!;
    expect(result.answers).toEqual({ accession: 'PF00545.26', lines: 20, bytes: Buffer.byteLength(BODY) });
  });

  it('RESIDENCY IS DERIVED: no `whole` fold and the bytes are not retained — and there is no door to them', async () => {
    const streamed = await (await foldRead([accession, seenSoFar])).result;
    expect(streamed.residency).toBe('streamed');
    expect('landed' in streamed).toBe(false);
    expect(Object.keys(streamed).sort()).toEqual(['answers', 'bytes', 'residency', 'retrievedAt', 'version']);
    // …and it still vouches for what went past: the size and the version of the whole body
    expect(streamed.bytes).toBe(Buffer.byteLength(BODY));
  });

  it('…and ONE `whole` fold retains them, byte-identically to what `snapshot()` lands', async () => {
    const retained = await (await foldRead([accession, total])).result;
    expect(retained.residency).toBe('retained');
    const handle = await httpSource().openResource!({ format: 'text', via: 'http', at: `${base}/plain` }, { resource: 'alignment' });
    const asAlways = landed(await handle.snapshot());
    expect(retained.landed!.body).toBe(asAlways.body);
    expect(retained.landed!.format).toBe('text');
    expect(Object.keys(retained.landed!).sort()).toEqual(Object.keys(asAlways).sort());
  });

  it('THE VERSION IS THE SAME EITHER WAY — a folded hash of bytes nobody kept is the hash those bytes would have landed with', async () => {
    // the server vouches for nothing, so the version IS the content hash: the one number
    // that would betray a read that hashed something other than the whole body
    const handle = await httpSource().openResource!({ format: 'text', via: 'http', at: `${base}/plain` }, { resource: 'alignment' });
    const asAlways = landed(await handle.snapshot()).version;
    expect(asAlways).toMatch(/^hash:[0-9a-f]{8}$/);
    expect((await (await foldRead([total])).result).version).toBe(asAlways); // retained
    expect((await (await foldRead([accession])).result).version).toBe(asAlways); // streamed
    // …and the same holds for a `bytes` landing, which is hashed where it lies
    const bytesHandle = await httpSource().openResource!({ format: 'bytes', via: 'http', at: `${base}/plain` }, { resource: 'alignment' });
    const bytesVersion = landed(await bytesHandle.snapshot()).version;
    expect((await (await foldRead([accession], '/plain', 'bytes')).result).version).toBe(bytesVersion);
    expect((await (await foldRead([total], '/plain', 'bytes')).result).version).toBe(bytesVersion);
  });

  it('THE PAYOFF: a body nobody declared they need whole stops having a size limit — and the same body with a `whole` fold does not', async () => {
    const cap = { maxBytes: 64 };
    // 64 bytes is a cap this body is far over, and the streamed read does not care: there is
    // nothing held, so there is no retention budget to spend
    const streamed = await (await foldRead([accession, seenSoFar], '/plain', 'text', cap)).result;
    expect(streamed.answers).toEqual({ accession: 'PF00545.26', lines: 20 });
    expect(streamed.bytes).toBeGreaterThan(64);
    // …and the cap is exactly as it was for a read that keeps the bytes
    expect(await refusalOf((await foldRead([accession, total], '/plain', 'text', cap)).result)).toMatch(
      /^too-large: resource "alignment" http source .*: too-large — \d+ UTF-16 units arrived and the read was stopped there \(the server declared no length\), the cap is 64$/,
    );
  });

  it('…including the guard that fires before a byte moves: a DECLARED length over the cap refuses a landing and not a stream', async () => {
    const cap = { maxBytes: 64 };
    const declared = await (await foldRead([seenSoFar], '/declared', 'text', cap)).result;
    expect(declared.answers).toEqual({ lines: 20 });
    expect(await refusalOf((await foldRead([total], '/declared', 'text', cap)).result)).toBe(
      `too-large: resource "alignment" http source ${base}/declared: too-large — the server declares ${String(Buffer.byteLength(BODY))} bytes, the cap is 64`,
    );
  });

  it('the report a host may still ask for is the same report, and an answer arrives BEFORE the report that closes its chunk', async () => {
    const order: string[] = [];
    const handle = await httpSource().openResource!({ format: 'text', via: 'http', at: `${base}/declared` }, { resource: 'alignment' });
    await handle.fold!([accession], {
      onProgress: (p) => order.push(`progress:${String(p.bytes)}`),
      onFoldValue: (a) => order.push(`answer:${String(a.bytes)}`),
    });
    // the chunk that carried the 48th byte is where the answer comes from, and the answer is
    // handed over BEFORE the report that closes that chunk
    const at = order.indexOf('answer:48');
    expect(at).toBeGreaterThan(-1);
    const closing = order[at + 1]!;
    expect(closing).toMatch(/^progress:/);
    expect(Number(closing.slice('progress:'.length))).toBeGreaterThanOrEqual(48);
    expect(order.filter((o) => o.startsWith('answer:'))).toEqual(['answer:48']);
  });

  it('a read that asks nothing is told nothing, and still answers', async () => {
    const handle = await httpSource().openResource!({ format: 'text', via: 'http', at: `${base}/plain` }, { resource: 'alignment' });
    const result = await handle.fold!([accession]);
    expect(result.answers).toEqual({ accession: 'PF00545.26' });
  });

  it('an observer that THROWS on every answer cannot change what the read computed', async () => {
    const handle = await httpSource().openResource!({ format: 'text', via: 'http', at: `${base}/plain` }, { resource: 'alignment' });
    const result = await handle.fold!([accession, seenSoFar], {
      onFoldValue: () => {
        throw new Error("the host's own render blew up");
      },
    });
    expect(result.answers).toEqual({ accession: 'PF00545.26', lines: 20 });
  });

  it('A DECLARED HEAD THE BODY COULD NOT SATISFY is refused by name, with the resource and the locator on the sentence', async () => {
    const tooBig: ResourceFold<string, string | undefined> = { ...accession, headBytes: 10_000_000 };
    expect(await refusalOf((await foldRead([tooBig])).result)).toBe(
      `malformed: resource "alignment" http source ${base}/plain: the fold "accession" declared it needs the first 10000000 bytes and the body ended after ${String(Buffer.byteLength(BODY))}; a short body is not a small header, so nothing was folded`,
    );
  });

  it('the caller\'s signal is honoured mid-stream, exactly as it is for a landing', async () => {
    const ac = new AbortController();
    const asked = await foldRead([seenSoFar], '/declared', 'text', {}, { signal: ac.signal, onProgress: () => ac.abort() });
    expect(await refusalOf(asked.result)).toBe(`cancelled: resource "alignment" http source ${base}/declared: cancelled — the request was aborted`);
  });

  it('a body with no bytes at all is `unavailable` for a fold read too — the zero-becomes-absence class', async () => {
    const empty = createServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((resolve) => empty.listen(0, '127.0.0.1', resolve));
    const addr = empty.address();
    const at = `http://127.0.0.1:${String(typeof addr === 'object' && addr !== null ? addr.port : 0)}/`;
    const handle = await httpSource().openResource!({ format: 'text', via: 'http', at }, { resource: 'alignment' });
    expect(await refusalOf(handle.fold!([seenSoFar]))).toBe(`unavailable: resource "alignment" http source ${at}: unavailable (200 with an empty body)`);
    await new Promise<void>((resolve) => empty.close(() => resolve()));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A FAKE FETCH — the bodies a server cannot be asked to produce.
// ─────────────────────────────────────────────────────────────────────────────

/** One response, its body in the chunks named, and the two shapes a real server will not give. */
interface Fake {
  readonly chunks: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  /** `res.body` is `null`: a host's own fetch, or a runtime with no streams. */
  readonly noStream?: true;
}

function fakeFetch(fake: Fake): { readonly fetch: typeof fetch; readonly calls: () => number; readonly usedWhole: () => boolean } {
  let calls = 0;
  let usedWhole = false;
  let delivered = 0;
  const parts = fake.chunks.map((c) => ENCODE.encode(c));
  const whole = (): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out;
  };
  let stream: ReadableStream<Uint8Array> | undefined;
  const res = {
    status: 200,
    ok: true,
    headers: new Headers(fake.headers ?? {}),
    get body(): ReadableStream<Uint8Array> | null {
      if (fake.noStream === true) return null;
      stream ??= new ReadableStream<Uint8Array>({
        pull: (controller) => {
          if (delivered < parts.length) {
            controller.enqueue(parts[delivered]!);
            delivered += 1;
            return;
          }
          controller.close();
        },
      });
      return stream;
    },
    text: async (): Promise<string> => {
      usedWhole = true;
      return DECODE.decode(whole());
    },
    arrayBuffer: async (): Promise<ArrayBuffer> => {
      usedWhole = true;
      return whole().buffer as ArrayBuffer;
    },
  };
  return {
    fetch: (async () => {
      calls += 1;
      return res;
    }) as unknown as typeof fetch,
    calls: () => calls,
    usedWhole: () => usedWhole,
  };
}

const AT = 'https://viz.example/PF00545.full';

const foldFake = async (
  fake: Fake,
  folds: readonly DeclaredFold[],
  opts: ResourceFoldOptions = {},
  format: ResourceFormat = 'text',
): Promise<{ readonly result: Promise<ResourceFoldResult>; readonly fetched: ReturnType<typeof fakeFetch> }> => {
  const fetched = fakeFetch(fake);
  const handle = await httpSource({ fetch: fetched.fetch }).openResource!({ format, via: 'http', at: AT }, { resource: 'alignment' });
  return { result: handle.fold!(folds, opts), fetched };
};

describe('WHOLE OR NOTHING still holds — and an answer already given is not retracted', () => {
  it('a body that ends short of a total the reader can trust refuses the READ, after the early answer was honestly made', async () => {
    const told: FoldAnswer[] = [];
    const { result } = await foldFake({ chunks: [HEADER, SEQS.slice(0, 20)], headers: { 'content-length': '100000' } }, [accession, total], { onFoldValue: (a) => told.push(a) });
    expect(await refusalOf(result)).toContain('a resource is not landed until it is whole, so nothing moved');
    // the head fold's answer was true of the head, which DID arrive whole — it is not retracted,
    // for the reason a progress report is not: it said what had arrived
    expect(told.map((a) => a.fold)).toEqual(['accession']);
    // …and the `whole` fold never answered, because there was never a whole body
    expect(told.some((a) => a.at === 'whole')).toBe(false);
  });
});

describe('a declaration is judged before a byte moves', () => {
  it('a bad declaration costs no request at all', async () => {
    const fetched = fakeFetch({ chunks: [BODY] });
    const handle = await httpSource({ fetch: fetched.fetch }).openResource!({ format: 'text', via: 'http', at: AT }, { resource: 'alignment' });
    expect(await refusalOf(handle.fold!([]))).toBe(
      `malformed: resource "alignment" http source ${AT}: no fold was declared, and a read that folds nothing is \`snapshot()\` — which lands the bytes`,
    );
    expect(await refusalOf(handle.fold!([{ ...seenSoFar, name: '' }]))).toContain("a fold's name is how its answer is told apart");
    expect(fetched.calls()).toBe(0);
  });
});

describe('a response with no readable stream', () => {
  it('cannot be folded THROUGH, so the folds see the body as the one chunk it is', async () => {
    const told: FoldAnswer[] = [];
    const { result, fetched } = await foldFake({ chunks: [BODY], noStream: true, headers: { 'content-length': String(Buffer.byteLength(BODY)) } }, [accession, seenSoFar, total], {
      onFoldValue: (a) => told.push(a),
    });
    const out = await result;
    expect(fetched.usedWhole()).toBe(true);
    expect(out.answers).toEqual({ accession: 'PF00545.26', lines: 20, bytes: Buffer.byteLength(BODY) });
    // one chunk, so the incremental fold answered once — over the whole body, which it says
    expect(told.filter((a) => a.at === 'incremental').map((a) => a.bytes)).toEqual([Buffer.byteLength(BODY)]);
    expect(out.residency).toBe('retained');
    expect(out.landed!.body).toBe(BODY);
  });

  it('…and a declared head it cannot satisfy is still refused, never answered from what arrived', async () => {
    const { result } = await foldFake({ chunks: ['# STOCKHOLM 1.0\n'], noStream: true }, [{ ...accession, headBytes: 64 }]);
    expect(await refusalOf(result)).toContain('a short body is not a small header');
  });

  it('…and a read that keeps nothing keeps nothing here either, with the same version', async () => {
    const { result } = await foldFake({ chunks: [BODY], noStream: true }, [accession]);
    const streamed = await result;
    expect(streamed.residency).toBe('streamed');
    expect('landed' in streamed).toBe(false);
    const { result: whole } = await foldFake({ chunks: [BODY], noStream: true }, [total]);
    expect(streamed.version).toBe((await whole).version);
  });

  it('a `bytes` landing folds and lands its own bytes', async () => {
    const { result } = await foldFake({ chunks: [BODY], noStream: true }, [accession, total], {}, 'bytes');
    const out = await result;
    expect(out.answers).toEqual({ accession: 'PF00545.26', bytes: Buffer.byteLength(BODY) });
    expect(out.landed!.format).toBe('bytes');
    expect(DECODE.decode(out.landed!.body as Uint8Array)).toBe(BODY);
  });
});

describe('the door a host calls, and the carriers that have nothing to offer it', () => {
  it('`foldResource` routes by `via`, and closes the handle it opened', async () => {
    const fetched = fakeFetch({ chunks: [HEADER, SEQS] });
    const out = await foldResource({ format: 'text', via: 'http', at: AT }, 'alignment', [accession, seenSoFar], [httpSource({ fetch: fetched.fetch })]);
    expect(out.answers).toEqual({ accession: 'PF00545.26', lines: 19 });
    expect(fetched.calls()).toBe(1);
  });

  it('…and a carrier whose transport hands back a whole body says so, rather than landing 169 MB nobody asked for', async () => {
    expect(await refusalOf(foldResource({ format: 'text', via: 'inline', at: BODY }, 'alignment', [accession]))).toBe(
      'no-adapter: resource "alignment" inline source: the inline adapter this host passed hands back a body it already holds whole — it declares no `fold`, and a fold attaches to bytes as they arrive',
    );
  });
});
