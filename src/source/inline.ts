/**
 * The inline carrier: the payload is the def itself. Its version is the one
 * thing that identifies the payload — its size and a content hash — since no
 * file system or server vouches for it.
 */
import { decodeRows } from './decode.js';
import type { SourceAdapter, SourceDecl } from './types.js';

/** FNV-1a over the payload's text — browser-safe, one pass, enough to tell two payloads apart. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The version an inline payload gets: `inline:<size>-<hash>` — the same words from both builders. */
export function inlineVersion(at: unknown): string {
  const text = typeof at === 'string' ? at : JSON.stringify(at);
  return `inline:${String(text.length)}-${fnv1a(text)}`;
}

export const inlineSource: SourceAdapter = {
  via: 'inline',
  async open(decl: SourceDecl, { table }) {
    const rows = decodeRows(decl.format, decl.at, decl.options);
    if ('rejected' in rows) throw new Error(`table "${table}" inline source: ${rows.rejected}`);
    const version = inlineVersion(decl.at);
    return {
      capabilities: { live: false, pushdown: false },
      snapshot: async () => ({ rows, version, retrievedAt: new Date().toISOString() }),
      close: async () => {},
    };
  },
};
