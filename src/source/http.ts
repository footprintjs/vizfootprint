/**
 * The http carrier — a URL fetched by THIS process (browser or node). Its own
 * module, like the file carrier: the barrel never assumes a network. The
 * version is what the server vouches for (an ETag, else Last-Modified), else
 * a hash of the bytes. Every way a request can fail has a name from the
 * closed vocabulary: cancelled (the caller's signal), timeout (no answer in
 * time), disconnected (no connection), unauthorized (401/403), unavailable
 * (any other non-2xx, or a 2xx with an empty body), too-large (over the byte
 * cap), malformed (the locator or the payload).
 */
import { decodeRows } from './decode.js';
import { fnv1a } from './hash.js';
import { SourceRefusal, isSourceRefusal } from './types.js';
import type { SourceAdapter, SourceDecl, SourceSnapshot } from './types.js';

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
        snapshot: async (opts): Promise<SourceSnapshot> => {
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
            res = await doFetch(at, { ...(options.headers ? { headers: options.headers } : {}), signal: controller.signal });
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
          const etag = res.headers.get('etag');
          const lastModified = res.headers.get('last-modified');
          // a weak validator stays weak: `W/` claims only semantic equivalence, and a version is a byte identity
          const version = etag !== null ? `etag:${etag.trim().replace(/"/g, '')}` : lastModified !== null ? `last-modified:${lastModified}` : `hash:${fnv1a(text)}`;
          return { rows, version, retrievedAt: new Date().toISOString() };
        },
        close: async () => {},
      };
    },
  };
}
