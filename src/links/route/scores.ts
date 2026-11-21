import type { RouteCandidate, RouteScore } from './types.js';
import { captureDelivery } from './delivery.js';

/** A synchronous array is already delivered; never inspect its extra then. */
export function captureScoresDelivery(candidates: readonly RouteCandidate[], result: unknown): RouteScore[] | Promise<RouteScore[]> {
  return Array.isArray(result) ? captureScores(candidates, result)
    : captureDelivery(result, value => captureScores(candidates, value));
}

/** One numeric score per declared candidate, returned in declaration order. */
export function captureScores(candidates: readonly RouteCandidate[], result: unknown): RouteScore[] {
  const count = candidates.length;
  if (!Array.isArray(result) || result.length !== count) throw new TypeError('One score per routing candidate is required');
  const known = new Set(candidates.map(candidate => candidate.id));
  const byId = new Map<string, RouteScore>();
  // Indexing, rather than a foreign iterator, bounds work by the candidate count.
  for (let index = 0; index < count; index++) {
    const { id, score } = result[index] as RouteScore;
    if (typeof id !== 'string' || typeof score !== 'number' || !known.has(id) || byId.has(id)) {
      throw new TypeError('Routing scores must name every candidate once and contain numbers');
    }
    byId.set(id, { id, score });
  }
  return candidates.map(candidate => byId.get(candidate.id)!);
}
