/**
 * Deterministic, seedable PRNG + standard-normal sampler. No dependencies.
 *
 * Used to make every simulation in the X2 packet reproducible: seed it and you
 * get the SAME numbers reported in the packet. The generator is `mulberry32`
 * (a well-known, public-domain 32-bit generator by Tommy Ettinger) driven by a
 * `splitmix32`-hashed seed; normals are drawn by the Box-Muller transform.
 *
 * These are intentionally simple and byte-stable, not cryptographic.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next: () => number;
  /** Standard normal N(0,1). */
  normal: () => number;
}

/** mulberry32: fast, decent-quality 32-bit PRNG (public domain). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create an Rng from a 32-bit integer seed. */
export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  let spare: number | null = null;
  function normal(): number {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    // Box-Muller; guard u1 away from 0 so log is finite.
    let u1 = next();
    const u2 = next();
    if (u1 < 1e-12) u1 = 1e-12;
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  }
  return { next, normal };
}

/** A vector of `n` iid standard normals. */
export function normalVector(rng: Rng, n: number): number[] {
  const v = new Array<number>(n);
  for (let i = 0; i < n; i++) v[i] = rng.normal();
  return v;
}
