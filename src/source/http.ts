/**
 * The http carrier — a URL fetched by THIS process (browser or node). It sits
 * ON the barrel, unlike the file carrier: this module imports no runtime and
 * reads the global `fetch` at CALL time, so a build that never calls it never
 * pays for it (PACKAGING.md Law 3 — a subpath is for a symbol whose PRESENCE
 * changes what the barrel costs). The
 * version is what the server vouches for (an ETag exactly as sent, weak marker
 * and quotes included, else Last-Modified), else a hash of the bytes.
 *
 * IT ALSO JUDGES WHAT THE SERVER SAID: a response whose content type is an HTML
 * document, answered for a source declared as a table, is `malformed` before a
 * row exists ({@link documentForATable}) — guard 1 of "a document is never a
 * table by accident" (./README.md). Every way a request can fail has a name from the
 * closed vocabulary: cancelled (the caller's signal), timeout (no answer in
 * time), disconnected (no connection), unauthorized (401/403), unavailable
 * (any other non-2xx, or a 2xx with an empty body), too-large (over the byte
 * cap), malformed (the locator or the payload).
 *
 * TWO DOORS, ONE REQUEST. A table asks for rows and a RESOURCE asks for bytes
 * (`openResource`), and the request itself — the conditional headers, the
 * timeout over headers AND body, every named failure — is written ONCE
 * ({@link fetchAnswer}), with each door supplying only the two things that
 * differ: how the body is READ, and what the HEADERS alone may still refuse.
 * For a resource that second thing is NOTHING, and that is the honest answer:
 * guard 1 refuses a content type that CONTRADICTS a declared format, and no
 * content type contradicts a declaration that asks for bytes.
 *
 * AND A RESOURCE'S BYTES MAY ARRIVE PROGRESSIVELY. A resource read that carries
 * an `onProgress` observer is read through the response's own stream
 * ({@link readProgressively}) — chunk by chunk, on THIS thread: reported as it
 * arrives, capped as it arrives, cut off mid-stream when the caller's signal
 * says so, and **landed only when it is whole**. A read that carries no
 * observer is the read this carrier always made, byte for byte
 * ({@link readWhole}): one act, `res.body` never touched. Two strategies behind
 * one door, chosen by whether the host asked to be told — which is why a host
 * that asks nothing cannot be surprised by anything.
 */
import { decodeRows } from './decode.js';
import { fnv1a } from './hash.js';
import { declaredLength, reportProgress, tooLargeMidStream, tooLargeOnArrival, totalOf } from './progress.js';
import type { DeclaredLength, ResourceProgressObserver } from './progress.js';
import { resourceBytes, resourceHash, resourceSnapshotOf, resourceWhere, type ResourceBody } from './resource.js';
import { ResourceRefusal, SourceRefusal, isResourceRefusal, isSourceRefusal } from './types.js';
import type { ResourceDecl, ResourceFormat, ResourceSnapshot, ResourceSnapshotOptions, SnapshotOptions, SourceAdapter, SourceDecl, SourceFormat, SourceRefusalReason, SourceSnapshot, SourceUnchanged } from './types.js';

export interface HttpSourceOptions {
  /** The fetch to use (a host may pass a wrapped one); default = the global fetch, read at call time. */
  readonly fetch?: typeof fetch;
  /** No answer — headers AND body — within this many ms is a `timeout` refusal. Default 10 000. */
  readonly timeoutMs?: number;
  /** Headers sent with every request (an Accept, an Authorization the host owns). */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * A body beyond this many bytes is a `too-large` refusal — by Content-Length before any byte is read
   * (the one guard that costs nothing, and the only one a declaration of OTHER bytes can honestly serve:
   * see `./progress.ts`), and then by what actually arrived, in the unit the landing is judged in. A
   * PROGRESSIVE resource read asks that second guard chunk by chunk, so a body over the cap stops instead
   * of finishing; the verdict is the same either way. Default 64 MiB.
   */
  readonly maxBytes?: number;
}

/** How a door names its own refusals: the reason from the closed vocabulary, one sentence, already prefixed with what was asked for. */
type Refuse = (reason: SourceRefusalReason, detail: string) => Error;

/** Either door's own refusal on its way back out of the request — never re-diagnosed as a network fault. */
const isOurRefusal = (e: unknown): boolean => isSourceRefusal(e) || isResourceRefusal(e);

/**
 * The validator to send back: the entity-tag exactly as received (RFC 9110 §13.1.2 —
 * If-None-Match compares weakly, so a weak `W/"x"` goes back weak; the version keeps
 * the quotes and the marker, so a CDN that flips weakness yields a different version,
 * which is the honest answer, not a spurious "unchanged").
 */
function etagHeader(stored: string): string {
  return stored;
}

/**
 * The content types that are a DOCUMENT — a page a browser renders, not a table.
 * Two spellings of the one thing, compared by ESSENCE: `text/html; charset=utf-8`
 * is `text/html`, because a parameter says how the page is encoded and never what
 * it is.
 */
const DOCUMENT_TYPES: readonly string[] = ['text/html', 'application/xhtml+xml'];

/**
 * …and the declared formats a document CONTRADICTS.
 *
 * WHY `rows` is not one: `snapshot`'s own `rows` arm already refuses an HTML body
 * by name ("format rows needs a JSON list of row objects, and the body is not
 * JSON"), so this guard would only change which of two refusals a caller reads.
 * `csv` has no such backstop at all — a document parses into a one-column table —
 * and `json` has one whose sentence never says what the server answered.
 */
const DOCUMENT_CONTRADICTS: readonly SourceFormat[] = ['csv', 'json'];

/** The essence of a content type: the media type alone, without its parameters. */
const essenceOf = (contentType: string): string => contentType.split(';')[0]!.trim().toLowerCase();

/**
 * GUARD 1 — THE CARRIER JUDGES WHAT THE SERVER SAID. The sentence for a document
 * answered where a table was declared, or `undefined` when there is nothing to
 * refuse.
 *
 * NARROW ON PURPOSE: a server may legitimately serve CSV as `text/csv`,
 * `text/plain` or `application/octet-stream`, and many serve no content type at
 * all — so this refuses a CONTRADICTION (the server named a document) and never a
 * non-match. Refuse on evidence, never on ignorance: a missing header is
 * ignorance, and a table is not refused for it.
 *
 * WHY the header is quoted AS RECEIVED while the comparison drops its
 * parameters: the essence is what decides, and the whole string is what the
 * reader has to go and look at.
 */
function documentForATable(contentType: string | null, format: SourceFormat): string | undefined {
  if (contentType === null || !DOCUMENT_CONTRADICTS.includes(format)) return undefined;
  if (!DOCUMENT_TYPES.includes(essenceOf(contentType))) return undefined;
  return `the server answered content-type "${contentType}" for a source declared ${format} — a document is never a table by accident; point \`at\` at the data route, or find out why this one answers a page (an error page, an SPA's index.html)`;
}

/** Release a body we will not read. Cleanup never changes the diagnosis: a cancel that rejects is swallowed. */
async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* v8 ignore next -- undici's cancel does not reject; the guard exists for hosts whose fetch does */
  }
}

/** A conditional read: the version the caller holds becomes the validator the server understands. */
function conditionalOf(since: string | undefined): Record<string, string> {
  if (since === undefined) return {};
  if (since.startsWith('etag:')) return { 'if-none-match': etagHeader(since.slice('etag:'.length)) };
  if (since.startsWith('last-modified:')) return { 'if-modified-since': since.slice('last-modified:'.length) };
  return {};
}

/**
 * THE ONE REQUEST BOTH DOORS MAKE: the conditional fetch, the body read, and
 * every way either can fail named from the closed vocabulary. Answers the
 * response beside the body the caller asked for, or `{ unchanged }` when the
 * server said the held version still holds.
 *
 * `readBody` runs INSIDE the same try/finally as the fetch, which is the whole
 * reason it is a callback rather than the caller's next line: the timeout and
 * the caller's signal cover the whole answer — headers AND body — so a
 * connection that dies mid-body is `disconnected` and not an unhandled reject.
 * `beforeBody` is the last thing the HEADERS may refuse (guard 1 for a table;
 * nothing for a resource) and runs before a byte of the body is read.
 *
 * `readBody` is handed `abort` as well as the response: a reader that refuses a
 * body it is still receiving (a progressive read over the cap, a cancelled one)
 * must be able to CUT THE TRANSFER OFF, and the request's own controller is the
 * only thing that can. It is never called for an error that is not our own
 * refusal — the diagnosis below reads that controller, so aborting on a
 * transport fault would rename `disconnected` as `timeout`.
 */
async function fetchAnswer<T>(args: {
  readonly at: string;
  readonly options: HttpSourceOptions;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly opts: SnapshotOptions | undefined;
  readonly refuse: Refuse;
  readonly beforeBody: (res: Response) => string | undefined;
  readonly readBody: (res: Response, abort: () => void) => Promise<T>;
}): Promise<{ readonly res: Response; readonly body: T } | SourceUnchanged> {
  const { at, options, timeoutMs, maxBytes, opts, refuse, beforeBody, readBody } = args;
  // a missing runtime fetch is a missing carrier, not a network fault
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw refuse('no-adapter', 'no-adapter — this runtime has no fetch; pass one in httpSource({ fetch })');
  if (opts?.signal?.aborted) throw refuse('cancelled', 'cancelled — the request was aborted before it started');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = (): void => controller.abort();
  opts?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // the whole answer — headers and body — sits under the timeout and the caller's signal
    const since = opts?.sinceVersion;
    const res = await doFetch(at, { headers: { ...(options.headers ?? {}), ...conditionalOf(since) }, signal: controller.signal });
    if (res.status === 304 && since !== undefined) {
      await drain(res);
      return { unchanged: true, version: since };
    }
    if (res.status === 401 || res.status === 403) {
      await drain(res);
      throw refuse('unauthorized', `unauthorized (${String(res.status)})`);
    }
    if (!res.ok) {
      await drain(res);
      throw refuse('unavailable', `unavailable (${String(res.status)})`);
    }
    // THE ONE REAL GUARD BEFORE THE BYTES MOVE, and it stays as it was for a
    // declaration this reader cannot fully trust (`./progress.ts` — a gzipped
    // body's declaration counts compressed bytes): over the cap COMPRESSED is
    // over the cap decoded too, so refusing on it can only ever be right. What
    // such a declaration cannot do is ADMIT a body safely, which is why the cap
    // is asked again of what arrives — chunk by chunk on a progressive read.
    const declared = declaredLength(res.headers);
    if (declared.kind !== 'none' && declared.bytes > maxBytes) {
      await drain(res);
      throw refuse('too-large', `too-large — the server declares ${String(declared.bytes)} bytes, the cap is ${String(maxBytes)}`);
    }
    // the last thing the HEADERS can settle, before a byte of the body is read
    const refusedByHeaders = beforeBody(res);
    if (refusedByHeaders !== undefined) {
      await drain(res);
      throw refuse('malformed', refusedByHeaders);
    }
    return { res, body: await readBody(res, () => controller.abort()) };
  } catch (e) {
    if (isOurRefusal(e)) throw e;
    if (opts?.signal?.aborted) throw refuse('cancelled', 'cancelled — the request was aborted');
    if (controller.signal.aborted) throw refuse('timeout', `timeout — no answer within ${String(timeoutMs)} ms`);
    throw refuse('disconnected', `disconnected — ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * WHAT THE ARRIVED BODY SETTLES, for either door: that something came at all
 * (the zero-becomes-absence class, refused by name), that not too much came,
 * and the version — the server's own validator, else a hash of what arrived.
 *
 * `size`/`unit` differ per door because what a door can honestly count differs:
 * a table's body is a string, so the diagnostic quotes UTF-16 units; a resource
 * declared `bytes` counted real bytes. The sentence shape is one.
 */
function versionOfBody(args: {
  readonly res: Response;
  readonly size: number;
  readonly unit: string;
  readonly hash: () => string;
  readonly maxBytes: number;
  readonly refuse: Refuse;
}): string {
  const { res, size, unit, hash, maxBytes, refuse } = args;
  // the place answered without data — the zero-becomes-absence class, refused by name
  if (size === 0) throw refuse('unavailable', `unavailable (${String(res.status)} with an empty body)`);
  // THE LAST WORD ON THE CAP, for either strategy: a progressive read stops the
  // transfer at this same threshold in this same unit, so its early refusal only
  // ever spares the wire — the verdict is decided here, once, for both.
  if (size > maxBytes) throw refuse('too-large', tooLargeOnArrival(size, unit, declaredLength(res.headers), maxBytes));
  const etag = res.headers.get('etag');
  const lastModified = res.headers.get('last-modified');
  return etag !== null ? `etag:${etag.trim()}` : lastModified !== null ? `last-modified:${lastModified}` : `hash:${hash()}`;
}

/**
 * The unit the CAP is judged in, per landing — real bytes for `bytes`, UTF-16
 * units for `text` (the same diagnostic the table door quotes, for the same
 * reason). One owner, because two readers ask it: the whole-body read's
 * {@link versionOfBody} and the progressive read's own early check.
 */
const unitOf = (format: ResourceFormat): string => (format === 'bytes' ? 'bytes' : 'UTF-16 units');

/** THE READ THIS CARRIER ALWAYS MADE: the whole body in one act, and `res.body` never touched. */
const readWhole = async (res: Response, format: ResourceFormat): Promise<ResourceBody> =>
  format === 'bytes' ? { format: 'bytes', body: new Uint8Array(await res.arrayBuffer()) } : { format: 'text', body: await res.text() };

/**
 * A body accumulating chunk by chunk, in the two shapes a declaration can ask
 * for. `size` is what has landed in the unit the CAP is judged in
 * ({@link unitOf}) — which is not the byte count a progress report carries, and
 * deliberately so: one number answers "how far along is the transfer", the other
 * answers "is this body too big for the declared cap", and a text body makes
 * them different numbers.
 */
interface BodySink {
  push(chunk: Uint8Array): void;
  size(): number;
  done(): ResourceBody;
}

/** Bytes: the chunks kept as they came, joined once at the end — the one copy a `Uint8Array` landing needs. */
function bytesSink(): BodySink {
  const chunks: Uint8Array[] = [];
  let size = 0;
  return {
    push: (chunk) => {
      chunks.push(chunk);
      size += chunk.byteLength;
    },
    size: () => size,
    done: () => {
      const body = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        body.set(chunk, at);
        at += chunk.byteLength;
      }
      return { format: 'bytes', body };
    },
  };
}

/**
 * Text: decoded AS IT ARRIVES, which is the half of this that keeps a frame
 * free — a 169 MB `res.text()` is one uninterruptible decode, and a 64 KiB
 * chunk's is microseconds.
 *
 * `new TextDecoder()` is exactly what `Response.text()` does (UTF-8, and the
 * default `ignoreBOM: false` strips a leading BOM), so the two strategies land
 * the same string; `{ stream: true }` is what carries a multi-byte character
 * split across a chunk boundary, and the final flush is what closes a truncated
 * one.
 */
function textSink(): BodySink {
  const decoder = new TextDecoder();
  const pieces: string[] = [];
  let size = 0;
  return {
    push: (chunk) => {
      const piece = decoder.decode(chunk, { stream: true });
      pieces.push(piece);
      size += piece.length;
    },
    size: () => size,
    done: () => ({ format: 'text', body: pieces.join('') + decoder.decode() }),
  };
}

/**
 * THE PROGRESSIVE READ — and the law it keeps: **bytes may arrive
 * progressively, and a resource is not LANDED until it is whole.**
 *
 * Reports what has arrived as it arrives, asks the cap of what has arrived,
 * honours the caller's signal MID-STREAM (not only before the first byte), and
 * answers a {@link ResourceBody} only when the body ended whole. Every refusal
 * path returns no body at all, so no caller — and no act anywhere above this —
 * can reach a partial one: the accumulated chunks are dropped with this frame.
 *
 * WHERE IT RUNS, and why there is no worker: accumulating bytes is not work — a
 * chunk is pushed onto a list and counted — and a worker would add a transfer
 * of every chunk plus a message hop for every report, while the bytes still
 * have to end up in this heap to be handed to a renderer. The one real cost,
 * decoding text, is done incrementally here, which is precisely what a worker
 * would have been for.
 */
async function readProgressively(args: {
  readonly stream: ReadableStream<Uint8Array>;
  readonly format: ResourceFormat;
  readonly resource: string;
  readonly declared: DeclaredLength;
  readonly onProgress: ResourceProgressObserver;
  readonly signal: AbortSignal | undefined;
  readonly maxBytes: number;
  readonly refuse: Refuse;
  readonly abort: () => void;
}): Promise<ResourceBody> {
  const { stream, format, resource, declared, onProgress, signal, maxBytes, refuse, abort } = args;
  const sink = format === 'bytes' ? bytesSink() : textSink();
  const total = totalOf(declared);
  // "unknown total" is the ABSENCE of the key, never a zero (`./progress.ts`)
  const totalFragment = total === undefined ? {} : { total };
  let bytes = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      // the caller's signal, honoured between chunks: a real fetch errors the
      // reader when the controller aborts, but a host's own stream need not
      if (signal?.aborted) throw refuse('cancelled', 'cancelled — the request was aborted');
      bytes += next.value.byteLength;
      sink.push(next.value);
      // the cap, asked of what has ARRIVED — so a body over it stops here instead of
      // finishing. `versionOfBody` asks the same threshold in the same unit of whatever
      // reaches it, which is why the two strategies cannot disagree on the VERDICT; the
      // count differs, and this sentence says that it stopped so the number is never read
      // as the body's size
      if (sink.size() > maxBytes) throw refuse('too-large', tooLargeMidStream(sink.size(), unitOf(format), declared, maxBytes));
      reportProgress(onProgress, { resource, bytes, ...totalFragment });
    }
    // WHOLE OR NOTHING. A stream that ends CLEANLY short of a total this reader
    // can trust delivered a partial body, and a partial resource is never a
    // shorter answer — so it is refused by name and nothing moves. With no
    // trustworthy total there is nothing to compare and this reader claims
    // nothing: a truncated body then arrives as the transport's own error
    // (chunked framing, the runtime's own check), which is `disconnected` too.
    if (total !== undefined && bytes < total) {
      throw refuse('disconnected', `disconnected — the body ended after ${String(bytes)} bytes of the ${String(total)} the server declared; a resource is not landed until it is whole, so nothing moved`);
    }
    return sink.done();
  } catch (e) {
    // OUR refusal means the transfer is still alive and we chose to stop: cut it
    // off, or a 169 MB body keeps arriving for a read nobody will be answered.
    // A transport fault has already ended it, and aborting there would rename it.
    if (isOurRefusal(e)) abort();
    throw e;
  }
}

export function httpSource(options: HttpSourceOptions = {}): SourceAdapter {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  return {
    via: 'http',
    async open(decl: SourceDecl, { table }) {
      const at = decl.at;
      if (typeof at !== 'string' || !/^https?:\/\//.test(at)) throw new SourceRefusal('malformed', `table "${table}" http source: \`at\` must be an http(s) URL`, table, 'http');
      const where = `table "${table}" http source ${at}`;
      const refuse: Refuse = (reason, detail) => new SourceRefusal(reason, `${where}: ${detail}`, table, 'http');
      return {
        capabilities: { live: false, pushdown: false },
        snapshot: async (opts): Promise<SourceSnapshot | SourceUnchanged> => {
          const answer = await fetchAnswer({
            at,
            options,
            timeoutMs,
            maxBytes,
            opts,
            refuse,
            // guard 1: a document answered where a table was declared is refused before the body is read
            beforeBody: (res) => documentForATable(res.headers.get('content-type'), decl.format),
            readBody: (res) => res.text(),
          });
          if ('unchanged' in answer) return answer;
          const text = answer.body;
          const version = versionOfBody({ res: answer.res, size: text.length, unit: 'UTF-16 units', hash: () => fnv1a(text), maxBytes, refuse });
          // a server that vouches for nothing: the hash decides the conditional read after the read (the bytes moved, the decode is saved)
          if (opts?.sinceVersion !== undefined && opts.sinceVersion === version) return { unchanged: true, version };
          let payload: unknown = text;
          if (decl.format === 'rows') {
            try {
              payload = JSON.parse(text);
            } catch {
              throw refuse('malformed', 'format rows needs a JSON list of row objects, and the body is not JSON');
            }
          }
          const rows = decodeRows(decl.format, payload, decl.options);
          if ('rejected' in rows) throw refuse('malformed', rows.rejected);
          return { rows, version, retrievedAt: new Date().toISOString() };
        },
        close: async () => {},
      };
    },
    async openResource(decl: ResourceDecl, { resource }) {
      const locator = decl.at;
      if (typeof locator !== 'string' || !/^https?:\/\//.test(locator)) throw new ResourceRefusal('malformed', `${resourceWhere(resource, 'http')}: \`at\` must be an http(s) URL`, resource, 'http');
      // named once, here, with the refusal already thrown: a HOISTED `snapshot` below cannot carry
      // the narrowing (it could be called before the guard ran), so the narrow type is the declaration's
      const at: string = locator;
      const where = resourceWhere(resource, 'http', at);
      const refuse: Refuse = (reason, detail) => new ResourceRefusal(reason, `${where}: ${detail}`, resource, 'http');
      // the two signatures are `ResourceHandle.snapshot`'s own (`./types.js`): only a CONDITIONAL read may answer `unchanged`
      async function snapshot(opts?: ResourceSnapshotOptions & { readonly sinceVersion?: undefined }): Promise<ResourceSnapshot>;
      async function snapshot(opts: ResourceSnapshotOptions & { readonly sinceVersion: string }): Promise<ResourceSnapshot | SourceUnchanged>;
      async function snapshot(opts?: ResourceSnapshotOptions): Promise<ResourceSnapshot | SourceUnchanged> {
        const answer = await fetchAnswer<ResourceBody>({
          at,
          options,
          timeoutMs,
          maxBytes,
          opts,
          refuse,
          // NOTHING the headers can refuse here: guard 1 refuses a content type that
          // CONTRADICTS a declared format, and a declaration that asks for bytes is
          // contradicted by none — a structure file served as text/html is still those bytes
          beforeBody: () => undefined,
          readBody: async (res, abort) => {
            const onProgress = opts?.onProgress;
            // NO OBSERVER: the read this carrier always made, byte for byte
            if (onProgress === undefined) return readWhole(res, decl.format);
            const declared = declaredLength(res.headers);
            if (res.body === null) {
              // A response with no readable stream — a host's own `fetch`, a runtime
              // without them. It cannot be reported progressively, and the one report it
              // CAN honestly make is the arrival, made once the bytes are here.
              const whole = await readWhole(res, decl.format);
              const total = totalOf(declared);
              reportProgress(onProgress, { resource, bytes: resourceBytes(whole), ...(total === undefined ? {} : { total }) });
              return whole;
            }
            return readProgressively({ stream: res.body, format: decl.format, resource, declared, onProgress, signal: opts?.signal, maxBytes, refuse, abort });
          },
        });
        if ('unchanged' in answer) return answer;
        const landed = answer.body;
        // `bytes` counts real bytes; `text` counts UTF-16 units, the same diagnostic the
        // table door quotes for the same reason (the one real cap is Content-Length, before the read)
        const version = versionOfBody({ res: answer.res, size: landed.body.length, unit: unitOf(landed.format), hash: () => resourceHash(landed), maxBytes, refuse });
        if (opts?.sinceVersion !== undefined && opts.sinceVersion === version) return { unchanged: true, version };
        // …and no decode: there are no columns to judge, so the bytes land as they arrived
        return resourceSnapshotOf(landed, version, new Date().toISOString());
      }
      return { capabilities: { live: false, pushdown: false }, snapshot, close: async () => {} };
    },
  };
}
