import { routeIntent } from '../route.js';
import type { RouteDecision, RouteNode, RoutePort, RouteScore, RouteVerdict } from './types.js';

export const nodes = (): RouteNode[] => [
  { id: 'a', viewId: 'a', kinds: ['point'], does: 'alpha', examples: ['choose alpha'] },
  { id: 'b', viewId: 'b', kinds: ['interval'], does: 'beta' },
];
export const scores = (): RouteScore[] => [{ id: 'a', score: 1 }, { id: 'b', score: 0 }];
export const decision = (rows: readonly RouteScore[] = scores()): RouteDecision => ({
  kind: 'move', to: 'a', decisive: true,
  ranked: rows.map(({ id, score }) => ({ id, score, relevance: 0.5 })),
});
export const port = (): RoutePort => ({ policy: { nearTieMargin: 0.15, menuSize: 3 }, scorer: { name: 'fixture', score: scores }, decide: decision });
export const unmatched = { kind: 'unmatched', ranked: [], decisive: false };
export const invoke = (value: unknown, input = nodes(), options?: unknown): Promise<RouteVerdict> =>
  Reflect.apply(routeIntent, undefined, ['alpha', input, value, options]);
