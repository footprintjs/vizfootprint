/**
 * THE SIZE CAP IS ASKED AS THE BODY ARRIVES.
 *
 * The web source used to read a whole body (`res.text()`, `res.arrayBuffer()`)
 * and compare its size with `maxBytes` afterwards. A server that declared no
 * length, or a false one, had its whole body in the host's memory before
 * anything refused it. The body is read through its stream now, and cut off at
 * the chunk that crosses the cap.
 *
 * | the answer                                   | table read                 | resource read, no observer |
 * |----------------------------------------------|----------------------------|----------------------------|
 * | under the cap, in many chunks                | lands, whole               | lands, whole               |
 * | exactly at the cap                           | lands                      | lands                      |
 * | over the cap, no declared length             | cut off, aborted           | cut off, aborted           |
 * | over the cap, a FALSE small declared length  | cut off, aborted           | cut off, aborted           |
 * | endless                                      | cut off, aborted           | cut off, aborted           |
 * | no readable stream (`body: null`)            | read whole, refused after  | read whole, refused after  |
 * | a multi-byte character split across chunks   | decoded as one character   | decoded as one character   |
 * | a body that is a stream of another kind      | read whole, as before      | read whole, as before      |
 * | chunks that are raw buffers or other views   | counted as bytes           | the same bytes land        |
 * | chunks that are not bytes at all             | refused `malformed`        | refused `malformed`        |
 * | a declared length LARGER than the body       | lands (the transport's to judge) | lands                |
 * | a host stream that ignores the abort         | the stream is cancelled    | the stream is cancelled    |
 */
import { describe, expect, it } from 'vitest';
import { httpSource } from './http.js';

const AT = 'https://viz.example/rows.csv';
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

interface Fake {
  /** Each chunk the body delivers, or a function for a body with no end. */
  readonly chunks: readonly Uint8Array[] | ((index: number) => Uint8Array);
  /** What the stream enqueues for each chunk, when it is not the chunk itself. */
  readonly as?: (chunk: Uint8Array) => unknown;
  /** `body` is an object with no `getReader`: a stream of another kind. */
  readonly foreignBody?: boolean;
  readonly headers?: Record<string, string>;
  readonly noStream?: boolean;
}

function fakeFetch(fake: Fake) {
  let pulled = 0;
  let usedWhole = false;
  let cancelled = false;
  let signal: AbortSignal | undefined;
  const next = (i: number): Uint8Array | undefined => (typeof fake.chunks === 'function' ? fake.chunks(i) : fake.chunks[i]);
  const whole = (): Uint8Array => {
    usedWhole = true;
    const all = fake.chunks as readonly Uint8Array[];
    const out = new Uint8Array(all.reduce((n, c) => n + c.byteLength, 0));
    let at = 0;
    for (const c of all) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  };
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const chunk = next(pulled);
      if (chunk === undefined) return controller.close();
      pulled += 1;
      controller.enqueue((fake.as?.(chunk) ?? chunk) as Uint8Array);
    },
    cancel: () => {
      cancelled = true;
    },
  });
  const res = {
    status: 200,
    ok: true,
    headers: new Headers(fake.headers ?? {}),
    body: fake.noStream === true ? null : fake.foreignBody === true ? { pipe: () => undefined } : body,
    text: async () => new TextDecoder().decode(whole()),
    arrayBuffer: async () => whole().buffer as ArrayBuffer,
  };
  return {
    fetch: (async (_url: unknown, init: { signal?: AbortSignal }) => {
      signal = init.signal;
      return res;
    }) as unknown as typeof fetch,
    pulled: () => pulled,
    usedWhole: () => usedWhole,
    aborted: () => signal?.aborted === true,
    cancelled: () => cancelled,
  };
}

const reasonOf = async (read: Promise<unknown>): Promise<string> => {
  try {
    await read;
    return 'landed';
  } catch (e) {
    return `${(e as { reason?: string }).reason ?? 'threw'}: ${(e as Error).message}`;
  }
};

const table = async (fake: ReturnType<typeof fakeFetch>, maxBytes: number) =>
  (await httpSource({ fetch: fake.fetch, maxBytes }).open({ format: 'csv', via: 'http', at: AT }, { table: 'rows' })).snapshot();
const resource = async (fake: ReturnType<typeof fakeFetch>, maxBytes: number, format: 'text' | 'bytes' = 'bytes') =>
  (await httpSource({ fetch: fake.fetch, maxBytes }).openResource!({ format, via: 'http', at: AT }, { resource: 'file' })).snapshot();

const ROWS = ['a,b\n', '1,2\n', '3,4\n'].map(encode);
const tenByteChunks = (count: number): Uint8Array[] => Array.from({ length: count }, () => encode('x'.repeat(9) + '\n'));

describe('a table read', () => {
  it('under the cap, in many chunks: lands whole, through the stream', async () => {
    const fake = fakeFetch({ chunks: ROWS });
    const snap = await table(fake, 1000);
    expect('rows' in snap && snap.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    expect(fake.usedWhole()).toBe(false);
    expect(fake.aborted()).toBe(false);
  });

  it('exactly at the cap: lands', async () => {
    const fake = fakeFetch({ chunks: ROWS });
    expect('rows' in (await table(fake, 12))).toBe(true);
  });

  it('one unit over the cap: refused', async () => {
    expect(await reasonOf(table(fakeFetch({ chunks: ROWS }), 11))).toMatch(/^too-large: .*12 UTF-16 units arrived and the read was stopped there/);
  });

  it('over the cap with no declared length: cut off at the chunk that crosses it, and the transfer is aborted', async () => {
    const fake = fakeFetch({ chunks: tenByteChunks(1000) });
    expect(await reasonOf(table(fake, 25))).toMatch(/^too-large: .*30 UTF-16 units arrived and the read was stopped there \(the server declared no length\), the cap is 25$/);
    expect(fake.pulled()).toBeLessThan(10);
    expect(fake.usedWhole()).toBe(false);
    expect(fake.aborted()).toBe(true);
  });

  it('over the cap behind a FALSE small declared length: the declaration passes the first guard, the arrival is still cut off', async () => {
    const fake = fakeFetch({ chunks: tenByteChunks(1000), headers: { 'content-length': '10' } });
    expect(await reasonOf(table(fake, 25))).toMatch(/^too-large: .*30 UTF-16 units arrived and the read was stopped there/);
    expect(fake.pulled()).toBeLessThan(10);
    expect(fake.aborted()).toBe(true);
  });

  it('a body with no end is cut off like any other', async () => {
    const fake = fakeFetch({ chunks: () => encode('x'.repeat(1024)) });
    expect(await reasonOf(table(fake, 4096))).toMatch(/^too-large: /);
    expect(fake.pulled()).toBeLessThan(10);
    expect(fake.aborted()).toBe(true);
  });

  it('a response with no readable stream is read whole, and refused over the cap after the fact', async () => {
    const fake = fakeFetch({ chunks: ROWS, noStream: true });
    expect(await reasonOf(table(fake, 5))).toMatch(/^too-large: .*12 UTF-16 units arrived \(the server declared no length\), the cap is 5$/);
    expect(fake.usedWhole()).toBe(true);
    expect('rows' in (await table(fakeFetch({ chunks: ROWS, noStream: true }), 1000))).toBe(true);
  });

  it('a character split across two chunks is one character, and a leading byte-order mark is not a column name', async () => {
    const bytes = encode('﻿name\né\n');
    const cut = bytes.length - 2; // inside the two bytes of "é"
    const snap = await table(fakeFetch({ chunks: [bytes.slice(0, cut), bytes.slice(cut)] }), 1000);
    expect('rows' in snap && snap.rows).toEqual([{ name: 'é' }]);
  });
});

describe('a resource read with no observer', () => {
  it('under the cap: lands the same bytes, through the stream', async () => {
    const fake = fakeFetch({ chunks: ROWS });
    const snap = await resource(fake, 1000);
    expect([...(snap.body as Uint8Array)]).toEqual([...encode('a,b\n1,2\n3,4\n')]);
    expect(fake.usedWhole()).toBe(false);
  });

  it.each(['bytes', 'text'] as const)('over the cap as %s: cut off, never read whole, aborted', async (format) => {
    const fake = fakeFetch({ chunks: tenByteChunks(1000) });
    expect(await reasonOf(resource(fake, 25, format))).toMatch(/^too-large: .*30 (bytes|UTF-16 units) arrived and the read was stopped there/);
    expect(fake.pulled()).toBeLessThan(10);
    expect(fake.usedWhole()).toBe(false);
    expect(fake.aborted()).toBe(true);
  });

  it('a response with no readable stream is read whole, and refused over the cap after the fact', async () => {
    const fake = fakeFetch({ chunks: ROWS, noStream: true });
    expect(await reasonOf(resource(fake, 5))).toMatch(/^too-large: .*12 bytes arrived \(the server declared no length\), the cap is 5$/);
    expect(fake.usedWhole()).toBe(true);
  });
});

describe('what a host’s own fetch may hand back', () => {
  it('a body that is a stream of another kind is read whole, as it always was', async () => {
    const fake = fakeFetch({ chunks: ROWS, foreignBody: true });
    const snap = await table(fake, 1000);
    expect('rows' in snap && snap.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    expect(fake.usedWhole()).toBe(true);
    const bytes = await resource(fakeFetch({ chunks: ROWS, foreignBody: true }), 1000);
    expect([...(bytes.body as Uint8Array)]).toEqual([...encode('a,b\n1,2\n3,4\n')]);
  });

  it.each<[string, (chunk: Uint8Array) => unknown]>([
    ['raw buffers', (c) => c.slice().buffer],
    ['views of another kind', (c) => new DataView(c.slice().buffer)],
    ['views into a larger buffer', (c) => {
      const wide = new Uint8Array(c.byteLength + 4);
      wide.set(c, 2);
      return new Uint8Array(wide.buffer, 2, c.byteLength);
    }],
  ])('chunks that are %s land the same bytes and the same rows', async (_what, as) => {
    const bytes = await resource(fakeFetch({ chunks: ROWS, as }), 1000);
    expect([...(bytes.body as Uint8Array)]).toEqual([...encode('a,b\n1,2\n3,4\n')]);
    const snap = await table(fakeFetch({ chunks: ROWS, as }), 1000);
    expect('rows' in snap && snap.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  });

  it('chunks that are not bytes are refused by name, never landed as something else', async () => {
    const asText = (c: Uint8Array): unknown => new TextDecoder().decode(c);
    expect(await reasonOf(table(fakeFetch({ chunks: ROWS, as: asText }), 1000))).toMatch(/^malformed: .*a body chunk that is not bytes \(\[object String\]\)/);
    expect(await reasonOf(resource(fakeFetch({ chunks: ROWS, as: asText }), 1000))).toMatch(/^malformed: /);
  });

  it('a declared length larger than the body does not refuse a plain read: a short body is the transport’s to judge', async () => {
    // what a browser shows for a compressed cross-origin answer: the compressed length, and no content-encoding
    const snap = await table(fakeFetch({ chunks: ROWS, headers: { 'content-length': '28' } }), 1000);
    expect('rows' in snap && snap.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    const bytes = await resource(fakeFetch({ chunks: ROWS, headers: { 'content-length': '5023' } }), 10_000);
    expect((bytes.body as Uint8Array).byteLength).toBe(12);
  });

  it('a refusal cancels the stream itself, for a host stream that does not listen to the abort', async () => {
    const fake = fakeFetch({ chunks: tenByteChunks(1000) });
    await reasonOf(table(fake, 25));
    expect(fake.cancelled()).toBe(true);
  });

  it('a reader with no way to be cancelled: the refusal still comes back as itself', async () => {
    const res = {
      status: 200,
      ok: true,
      headers: new Headers(),
      body: { getReader: () => ({ read: async () => ({ done: false, value: 'not bytes' }) }) },
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    const fetchIt = (async () => res) as unknown as typeof fetch;
    const read = (await httpSource({ fetch: fetchIt }).open({ format: 'csv', via: 'http', at: AT }, { table: 'rows' })).snapshot();
    expect(await reasonOf(read)).toMatch(/^malformed: .*not bytes/);
  });

  it('a reader whose cancel throws: the same', async () => {
    const res = {
      status: 200,
      ok: true,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: 7 }),
          cancel: () => {
            throw new Error('no');
          },
        }),
      },
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    const fetchIt = (async () => res) as unknown as typeof fetch;
    const read = (await httpSource({ fetch: fetchIt }).open({ format: 'csv', via: 'http', at: AT }, { table: 'rows' })).snapshot();
    expect(await reasonOf(read)).toMatch(/^malformed: /);
  });
});
