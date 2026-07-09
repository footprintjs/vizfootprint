/**
 * X2 spike — the batch Benjamini-Hochberg (1995) procedure, used ONLY as the
 * wrong-tool baseline in acceptance test A2. Not part of src/fdr's API:
 * vizfootprint ships ONLINE procedures because analyses arrive adaptively.
 *
 * Benjamini & Hochberg (1995), "Controlling the false discovery rate", JRSS-B
 * 57(1):289-300. Given m p-values and level q: sort ascending p_(1)..p_(m),
 * find the largest k with p_(k) <= (k/m) q, and reject the k smallest.
 * FDR <= (m0/m) q for independent (or PRDS) p-values — but ONLY when applied
 * ONCE to a fixed, pre-specified family. Applying it "retroactively at each
 * step" (peeking) over an adaptively-chosen, growing family voids that
 * guarantee; A2 measures exactly that inflation.
 */

/** Indices (into the input array) rejected by batch BH at level q. Applied once. */
export function benjaminiHochberg(pValues: readonly number[], q: number): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  // Largest k (1-indexed) with p_(k) <= (k/m) q.
  let kMax = 0;
  for (let k = 1; k <= m; k++) {
    if (order[k - 1]!.p <= (k / m) * q) kMax = k;
  }
  const rejected: number[] = [];
  for (let k = 0; k < kMax; k++) rejected.push(order[k]!.i);
  return rejected;
}

/** Did BH (applied once to this fixed set) reject at least one hypothesis? */
export function bhRejectsAny(pValues: readonly number[], q: number): boolean {
  return benjaminiHochberg(pValues, q).length > 0;
}
