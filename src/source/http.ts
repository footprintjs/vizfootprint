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
 */
import { decodeRows } from './decode.js';
import { fnv1a } from './hash.js';
import { resourceHash, resourceSnapshotOf, resourceWhere, type ResourceBody } from './resource.js';
import { ResourceRefusal, SourceRefusal, isResourceRefusal, isSourceRefusal } from './types.js';
import type { ResourceDecl, ResourceSnapshot, SnapshotOptions, SourceAdapter, SourceDecl, SourceFormat, SourceRefusalReason, SourceSnapshot, SourceUnchanged } from './types.js';

export interface HttpSourceOptions {
  /** The fetch to use (a host may pass a wrapped one); default = the global fetch, read at call time. */
  readonly fetch?: typeof fetch;
  /** No answer — headers AND body — within this many ms is a `timeout` refusal. Default 10 000. */
  readonly timeoutMs?: number;
  /** Headers sent with every request (an Accept, an Authorization the host owns). */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * A body beyond this many bytes is a `too-large` refusal — by Content-Length, the one real guard, before any
   * byte is read; when the server declares nothing, a diagnostic on what arrived (UTF-16 units, after the read). Default 64 MiB.
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
 */
async function fetchAnswer<T>(args: {
  readonly at: string;
  readonly options: HttpSourceOptions;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly opts: SnapshotOptions | undefined;
  readonly refuse: Refuse;
  readonly beforeBody: (res: Response) => string | undefined;
  readonly readBody: (res: Response) => Promise<T>;
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
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      await drain(res);
      throw refuse('too-large', `too-large — the server declares ${String(declared)} bytes, the cap is ${String(maxBytes)}`);
    }
    // the last thing the HEADERS can settle, before a byte of the body is read
    const refusedByHeaders = beforeBody(res);
    if (refusedByHeaders !== undefined) {
      await drain(res);
      throw refuse('malformed', refusedByHeaders);
    }
    return { res, body: await readBody(res) };
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
  if (size > maxBytes) throw refuse('too-large', `too-large — ${String(size)} ${unit} arrived (the server declared no length), the cap is ${String(maxBytes)}`);
  const etag = res.headers.get('etag');
  const lastModified = res.headers.get('last-modified');
  return etag !== null ? `etag:${etag.trim()}` : lastModified !== null ? `last-modified:${lastModified}` : `hash:${hash()}`;
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
      async function snapshot(opts?: SnapshotOptions & { readonly sinceVersion?: undefined }): Promise<ResourceSnapshot>;
      async function snapshot(opts: SnapshotOptions & { readonly sinceVersion: string }): Promise<ResourceSnapshot | SourceUnchanged>;
      async function snapshot(opts?: SnapshotOptions): Promise<ResourceSnapshot | SourceUnchanged> {
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
          readBody: async (res) => (decl.format === 'bytes' ? { format: 'bytes', body: new Uint8Array(await res.arrayBuffer()) } : { format: 'text', body: await res.text() }),
        });
        if ('unchanged' in answer) return answer;
        const landed = answer.body;
        // `bytes` counts real bytes; `text` counts UTF-16 units, the same diagnostic the
        // table door quotes for the same reason (the one real cap is Content-Length, before the read)
        const version = versionOfBody({ res: answer.res, size: landed.body.length, unit: landed.format === 'bytes' ? 'bytes' : 'UTF-16 units', hash: () => resourceHash(landed), maxBytes, refuse });
        if (opts?.sinceVersion !== undefined && opts.sinceVersion === version) return { unchanged: true, version };
        // …and no decode: there are no columns to judge, so the bytes land as they arrived
        return resourceSnapshotOf(landed, version, new Date().toISOString());
      }
      return { capabilities: { live: false, pushdown: false }, snapshot, close: async () => {} };
    },
  };
}
