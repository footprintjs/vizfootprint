/**
 * The inline carrier: the payload is the def itself. Its version is the one
 * thing that identifies the payload — its size and a content hash — since no
 * file system or server vouches for it.
 */
import { decodeRows } from './decode.js';
import { fnv1a } from './hash.js';
import { resourceBytes, resourceHash, resourceSnapshotOf, resourceWhere, type ResourceBody } from './resource.js';
import { ResourceRefusal, SourceRefusal } from './types.js';
import type { ResourceDecl, ResourceSnapshot, SnapshotOptions, SourceAdapter, SourceDecl, SourceUnchanged } from './types.js';


/** The version an inline payload gets: `inline:<size>-<hash>` — the same words from both builders. */
export function inlineVersion(at: unknown): string {
  const text = typeof at === 'string' ? at : JSON.stringify(at);
  return `inline:${String(text.length)}-${fnv1a(text)}`;
}

/**
 * The declared body of an inline RESOURCE, or the sentence refusing it. `text`
 * needs a string and `bytes` needs real bytes: an inline resource is the only
 * place a def can carry a `Uint8Array`, and coercing anything else into one
 * would invent a payload the author did not write.
 */
function inlineBody(decl: ResourceDecl): ResourceBody | { readonly rejected: string } {
  if (decl.format === 'text') {
    return typeof decl.at === 'string' ? { format: 'text', body: decl.at } : { rejected: '`at` must carry the text when format is text' };
  }
  return decl.at instanceof Uint8Array ? { format: 'bytes', body: decl.at } : { rejected: '`at` must carry a Uint8Array when format is bytes' };
}

/** The version an inline resource gets — the same `inline:<size>-<hash>` words, over the body's own bytes. */
function inlineResourceVersion(landed: ResourceBody): string {
  return `inline:${String(resourceBytes(landed))}-${resourceHash(landed)}`;
}

/**
 * THE INLINE LANDING BOTH BUILDERS MAKE, and the one the carrier wraps: the
 * payload is already here, so there is nothing to await — which is exactly why
 * the SYNCHRONOUS builder can land an inline resource, as it already lands an
 * inline table's rows (`../def/buildDashboard.ts`). A refusal comes back as a
 * sentence rather than thrown, because the sync door raises the def's problems
 * as one list.
 */
export function inlineResource(decl: ResourceDecl): ResourceSnapshot | { readonly rejected: string } {
  const landed = inlineBody(decl);
  if ('rejected' in landed) return landed;
  return resourceSnapshotOf(landed, inlineResourceVersion(landed), new Date().toISOString());
}

export const inlineSource: SourceAdapter = {
  via: 'inline',
  async open(decl: SourceDecl, { table }) {
    const rows = decodeRows(decl.format, decl.at, decl.options);
    if ('rejected' in rows) throw new SourceRefusal('malformed', `table "${table}" inline source: ${rows.rejected}`, table, 'inline');
    const version = inlineVersion(decl.at);
    return {
      capabilities: { live: false, pushdown: false },
      snapshot: async (options) => (options?.sinceVersion === version ? { unchanged: true, version } : { rows, version, retrievedAt: new Date().toISOString() }),
      close: async () => {},
    };
  },
  async openResource(decl: ResourceDecl, { resource }) {
    const opened = inlineResource(decl);
    if ('rejected' in opened) throw new ResourceRefusal('malformed', `${resourceWhere(resource, 'inline')}: ${opened.rejected}`, resource, 'inline');
    // named once, here, with the refusal already thrown: a HOISTED `snapshot` below cannot carry
    // the narrowing (it could be called before the guard ran), so the narrow type is the declaration's
    const landed: ResourceSnapshot = opened;
    // the version was taken over the body at the landing: an inline payload cannot move under us
    const version = landed.version;
    // the two signatures are `ResourceHandle.snapshot`'s own (`./types.js`): only a CONDITIONAL read may answer `unchanged`
    async function snapshot(options?: SnapshotOptions & { readonly sinceVersion?: undefined }): Promise<ResourceSnapshot>;
    async function snapshot(options: SnapshotOptions & { readonly sinceVersion: string }): Promise<ResourceSnapshot | SourceUnchanged>;
    async function snapshot(options?: SnapshotOptions): Promise<ResourceSnapshot | SourceUnchanged> {
      if (options?.sinceVersion === version) return { unchanged: true, version };
      return { ...landed, retrievedAt: new Date().toISOString() };
    }
    return { capabilities: { live: false, pushdown: false }, snapshot, close: async () => {} };
  },
};
