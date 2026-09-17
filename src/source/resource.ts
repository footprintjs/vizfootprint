/**
 * What every carrier has to be able to say about a RESOURCE it landed, in one
 * place: how big it is, what identifies it, and the facts row a reader is
 * handed instead of the payload.
 *
 * SIZE IS THE ONE FACT A READER GETS ABOUT A BODY IT MAY NOT BE HANDED (the
 * law: bytes never ride a wire a value may not ride), so it has to be a real
 * number for both formats — `bytes` measures its own array, `text` is counted
 * in UTF-8, which is what a byte count of text means everywhere else.
 */
import { fnv1a, fnv1aBytes } from './hash.js';
import type { ResourceDecl, ResourceInfo, ResourceSnapshot, SourceVia } from './types.js';

/**
 * How many BYTES a string is in UTF-8 — COUNTED, never materialised. The
 * obvious spelling (`new TextEncoder().encode(text).length`) allocates a second
 * copy of the whole body to learn its length, which for a 64 MiB document is
 * the most expensive possible way to answer a number.
 *
 * A LONE surrogate (half a pair, which a string may legally hold) is 3 bytes:
 * it encodes as the replacement character, and the pair arm must not consume a
 * following unit that is not its partner.
 */
export function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      n += 4;
      i++; // the low surrogate belongs to this character, not the next one
    } else n += 3;
  }
  return n;
}

/**
 * A body as a carrier READ it, already narrowed by the declared format — the
 * half of a snapshot that is about the bytes, with nothing about their
 * identity. A carrier reads one of these, then stamps it.
 */
export type ResourceBody = { readonly format: 'bytes'; readonly body: Uint8Array } | { readonly format: 'text'; readonly body: string };

/** The size of what landed, per format — the `bytes` a {@link ResourceInfo} carries. */
export function resourceBytes(landed: ResourceBody): number {
  return landed.format === 'bytes' ? landed.body.length : utf8Bytes(landed.body);
}

/** The content hash a carrier that vouches for nothing else falls back to — the same words for both formats (`hash:<8 hex>`). */
export function resourceHash(landed: ResourceBody): string {
  return landed.format === 'bytes' ? fnv1aBytes(landed.body) : fnv1a(landed.body);
}

/**
 * The facts row a reader gets: the declaration's own three tags, what the
 * carrier vouched for, and the SIZE. The payload is not here, and there is no
 * arm that could put it here — which is the point of the shape.
 */
export function resourceInfoOf(decl: ResourceDecl, snapshot: ResourceSnapshot): ResourceInfo {
  return {
    format: decl.format,
    via: decl.via,
    // an inline payload is never repeated; a locator is (the `SourceInfo` law, unchanged)
    ...(decl.via !== 'inline' && typeof decl.at === 'string' ? { at: decl.at } : {}),
    version: snapshot.version,
    retrievedAt: snapshot.retrievedAt,
    bytes: resourceBytes(snapshot),
  };
}

/** Stamp a read body with what the carrier vouches for — the ONE place a {@link ResourceSnapshot} is built, so no carrier spells the pair by hand. */
export const resourceSnapshotOf = (landed: ResourceBody, version: string, retrievedAt: string): ResourceSnapshot => ({ ...landed, version, retrievedAt });

/**
 * name → version: the stamp a commit carries, and the same fold an answer's
 * basis quotes for tables (`../agent/basis.ts` · `dataVersionsOf`). `{}` when
 * there are none, which is what "nothing to stamp" means to the log's hook.
 */
export function resourceVersionsOf(resources: Readonly<Record<string, ResourceInfo>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(resources).map(([name, info]) => [name, info.version] as const));
}

/** The words a carrier's sentence starts with, so a resource refusal reads like a table's with the noun changed. */
export function resourceWhere(resource: string, via: SourceVia, at?: string): string {
  return at === undefined ? `resource "${resource}" ${via} source` : `resource "${resource}" ${via} source ${at}`;
}
