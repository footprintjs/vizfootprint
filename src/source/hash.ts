/**
 * FNV-1a — browser-safe, one pass, enough to tell two payloads apart — and it
 * is ONE hash with two doors, which is a law and not a tidiness: the whole-body
 * hash IS the folded hash, run to the end.
 *
 * WHY THAT MATTERS: a body nobody declared they need whole is never held
 * (`./fold/README.md` — residency is derived), so a read that retains nothing
 * still has to vouch for what went past it. It folds the hash as the bytes go
 * by, and the digest is byte-identical to the one the same bytes would have
 * landed with — because it is the same loop. Residency is then an optimisation
 * that cannot change what a version means, which is the only kind of thing this
 * library automates.
 */
const SEED = 0x811c9dc5;
const PRIME = 0x01000193;

/** One unit into the hash: a byte, or a string's UTF-16 code unit — whichever the body is counted in. */
const step = (h: number, unit: number): number => Math.imul(h ^ unit, PRIME) >>> 0;

/** The 8 hex digits a version quotes. */
const digest = (h: number): string => h.toString(16).padStart(8, '0');

/**
 * The hash, FOLDED as the bytes go by. Two doors because a body has two shapes
 * — a `text` resource is hashed over its string exactly as `fnv1a` does it, a
 * `bytes` one over its bytes — and a folded run must land the digest the whole
 * body would.
 */
export interface Fnv1aFold {
  /** A decoded piece of a text body, in arrival order. */
  text(piece: string): void;
  /** A chunk of a byte body, in arrival order. */
  bytes(chunk: Uint8Array): void;
  /** What has gone past so far. */
  digest(): string;
}

/** A fold of the hash: start, push what arrives, ask. */
export function fnv1aFold(): Fnv1aFold {
  let h = SEED;
  return {
    text: (piece) => {
      for (let i = 0; i < piece.length; i++) h = step(h, piece.charCodeAt(i));
    },
    bytes: (chunk) => {
      for (let i = 0; i < chunk.length; i++) h = step(h, chunk[i]!);
    },
    digest: () => digest(h),
  };
}

/** FNV-1a over a string — the fold, run to the end. */
export function fnv1a(text: string): string {
  const fold = fnv1aFold();
  fold.text(text);
  return fold.digest();
}

/**
 * The same hash over real BYTES — a resource declared `bytes` never becomes a
 * string, so it is hashed where it is. Not `fnv1a(String(bytes))` and not a
 * decode: both would allocate a copy of a body that may be tens of megabytes,
 * to tell two of them apart.
 */
export function fnv1aBytes(bytes: Uint8Array): string {
  const fold = fnv1aFold();
  fold.bytes(bytes);
  return fold.digest();
}
