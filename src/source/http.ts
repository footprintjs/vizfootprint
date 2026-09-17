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
 */
import { decodeRows } from './decode.js';
import { fnv1a } from './hash.js';
import { SourceRefusal, isSourceRefusal } from './types.js';
import type { SourceAdapter, SourceDecl, SourceFormat, SourceSnapshot, SourceUnchanged } from './types.js';

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

export function httpSource(options: HttpSourceOptions = {}): SourceAdapter {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  return {
    via: 'http',
    async open(decl: SourceDecl, { table }) {
      const at = decl.at;
      if (typeof at !== 'string' || !/^https?:\/\//.test(at)) throw new SourceRefusal('malformed', `table "${table}" http source: \`at\` must be an http(s) URL`, table, 'http');
      const where = `table "${table}" http source ${at}`;
      const refuse = (reason: SourceRefusal['reason'], detail: string): SourceRefusal => new SourceRefusal(reason, `${where}: ${detail}`, table, 'http');
      return {
        capabilities: { live: false, pushdown: false },
        snapshot: async (opts): Promise<SourceSnapshot | SourceUnchanged> => {
          // a missing runtime fetch is a missing carrier, not a network fault
          const doFetch = options.fetch ?? globalThis.fetch;
          if (typeof doFetch !== 'function') throw refuse('no-adapter', 'no-adapter — this runtime has no fetch; pass one in httpSource({ fetch })');
          if (opts?.signal?.aborted) throw refuse('cancelled', 'cancelled — the request was aborted before it started');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const onAbort = (): void => controller.abort();
          opts?.signal?.addEventListener('abort', onAbort, { once: true });
          let text: string;
          let res: Response;
          try {
            // the whole answer — headers and body — sits under the timeout and the caller's signal
            // a conditional read: the version the caller holds becomes the validator the server understands
            const since = opts?.sinceVersion;
            const conditional: Record<string, string> =
              since === undefined ? {} : since.startsWith('etag:') ? { 'if-none-match': etagHeader(since.slice('etag:'.length)) } : since.startsWith('last-modified:') ? { 'if-modified-since': since.slice('last-modified:'.length) } : {};
            res = await doFetch(at, { headers: { ...(options.headers ?? {}), ...conditional }, signal: controller.signal });
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
            // the last thing the HEADERS can settle: a document answered where a table
            // was declared is refused before a byte of it is read, let alone parsed
            const document = documentForATable(res.headers.get('content-type'), decl.format);
            if (document !== undefined) {
              await drain(res);
              throw refuse('malformed', document);
            }
            text = await res.text();
          } catch (e) {
            if (isSourceRefusal(e)) throw e;
            if (opts?.signal?.aborted) throw refuse('cancelled', 'cancelled — the request was aborted');
            if (controller.signal.aborted) throw refuse('timeout', `timeout — no answer within ${String(timeoutMs)} ms`);
            throw refuse('disconnected', `disconnected — ${(e as Error).message}`);
          } finally {
            clearTimeout(timer);
            opts?.signal?.removeEventListener('abort', onAbort);
          }
          // the place answered without data — the zero-becomes-absence class, refused by name
          if (text.length === 0) throw refuse('unavailable', `unavailable (${String(res.status)} with an empty body)`);
          if (text.length > maxBytes) throw refuse('too-large', `too-large — ${String(text.length)} UTF-16 units arrived (the server declared no length), the cap is ${String(maxBytes)}`);
          const etag = res.headers.get('etag');
          const lastModified = res.headers.get('last-modified');
          const version = etag !== null ? `etag:${etag.trim()}` : lastModified !== null ? `last-modified:${lastModified}` : `hash:${fnv1a(text)}`;
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
  };
}
