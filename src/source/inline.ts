/**
 * The inline carrier: the payload is the def itself. Its version is the one
 * thing that identifies the payload — its size and a content hash — since no
 * file system or server vouches for it.
 */
import { decodeRows } from './decode.js';
import { fnv1a } from './hash.js';
import { SourceRefusal } from './types.js';
import type { SourceAdapter, SourceDecl } from './types.js';


/** The version an inline payload gets: `inline:<size>-<hash>` — the same words from both builders. */
export function inlineVersion(at: unknown): string {
  const text = typeof at === 'string' ? at : JSON.stringify(at);
  return `inline:${String(text.length)}-${fnv1a(text)}`;
}

export const inlineSource: SourceAdapter = {
  via: 'inline',
  async open(decl: SourceDecl, { table }) {
    const rows = decodeRows(decl.format, decl.at, decl.options);
    if ('rejected' in rows) throw new SourceRefusal('malformed', `table "${table}" inline source: ${rows.rejected}`, table, 'inline');
    const version = inlineVersion(decl.at);
    return {
      capabilities: { live: false, pushdown: false },
      snapshot: async () => ({ rows, version, retrievedAt: new Date().toISOString() }),
      close: async () => {},
    };
  },
};
