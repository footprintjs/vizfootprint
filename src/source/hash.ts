/** FNV-1a over a string — browser-safe, one pass, enough to tell two payloads apart. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The same hash over real BYTES — a resource declared `bytes` never becomes a
 * string, so it is hashed where it is. Not `fnv1a(String(bytes))` and not a
 * decode: both would allocate a copy of a body that may be tens of megabytes,
 * to tell two of them apart.
 */
export function fnv1aBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
