import type { RankedRouteScore, RouteDecision, RouteScore } from './types.js';

/** Only evidence integrity belongs here; the consumer decides the routing rule. */
export function captureDecision(result: unknown, scores: readonly RouteScore[]): RouteDecision {
  const { kind, ranked, decisive, runnerUp } = result as RouteDecision;
  if (typeof decisive !== 'boolean' || !Array.isArray(ranked) || ranked.length !== scores.length) {
    throw new TypeError('A routing decision must retain every candidate and a decisive flag');
  }
  const raw = new Map(scores.map(({ id, score }) => [id, score]));
  const seen = new Set<string>();
  const rows: RankedRouteScore[] = [];
  for (let index = 0; index < scores.length; index++) {
    const { id, score, relevance } = ranked[index] as RankedRouteScore;
    if (!raw.has(id) || seen.has(id) || !Object.is(score, raw.get(id)) || !Number.isFinite(relevance) || relevance < 0 || relevance > 1) {
      throw new TypeError('Ranked routing evidence must retain the declared IDs, raw scores and relevance shares');
    }
    seen.add(id);
    rows.push({ id, score, relevance });
  }
  let runner: { id: string; gap: number } | undefined;
  if (runnerUp !== undefined) {
    const { id, gap } = runnerUp;
    if (!raw.has(id) || !Number.isFinite(gap)) throw new TypeError('The routing runner-up must name a candidate and numeric gap');
    runner = { id, gap };
  }
  const evidence = { ranked: rows, decisive, ...(runner !== undefined ? { runnerUp: runner } : {}) };
  switch (kind) {
    case 'move': {
      const { to } = result as Extract<RouteDecision, { kind: 'move' }>;
      if (!raw.has(to)) throw new TypeError('A routing move must name a candidate');
      return { kind, to, ...evidence };
    }
    case 'menu': {
      const { offered } = result as Extract<RouteDecision, { kind: 'menu' }>;
      if (!Array.isArray(offered)) throw new TypeError('A routing menu must list candidates');
      const count = offered.length;
      if (!Number.isSafeInteger(count) || count > scores.length || count < 0) throw new TypeError('A routing menu is bounded by its candidates');
      const selected: string[] = [];
      const unique = new Set<string>();
      for (let index = 0; index < count; index++) {
        const id = offered[index] as string;
        if (!raw.has(id) || unique.has(id)) throw new TypeError('A routing menu must name known candidates once');
        selected.push(id);
        unique.add(id);
      }
      return { kind, offered: selected, ...evidence };
    }
    case 'stay':
    case 'unmatched': return { kind, ...evidence };
    default: throw new TypeError('A routing decision must be move, stay, menu or unmatched');
  }
}

export function unmatchedDecision(): RouteDecision {
  return { kind: 'unmatched', ranked: [], decisive: false };
}
