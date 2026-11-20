import { DEFAULT_ROUTING_POLICY, decideTier2, keywordScorer, validateIntentScores } from 'agentfootprint/skill-graph';
import type { IntentCandidate, IntentScorer, RoutingPolicy } from 'agentfootprint/skill-graph';
import type { RouteNode, RoutePort, RouteVerdict } from '../../src/links/route.js';

/** Exactly the thin adapter a consumer owns; scorer traits stay with its rule. */
export function hostPort(scorer: IntentScorer = keywordScorer()): RoutePort {
  return {
    policy: DEFAULT_ROUTING_POLICY,
    scorer: { name: scorer.name, score: (phrase, candidates, signal) => scorer.score({ message: phrase }, candidates.map(({ id, text, examples }) => ({ id, intent: text, examples })), signal) },
    decide: (scores, current, policy) => decideTier2(scores, current, policy, scorer),
  };
}

/** The pre-port route body, kept beside its replacement only for comparison. */
export async function oldRouteIntent(phrase: string, nodes: readonly RouteNode[], opts: {
  incumbent?: string; scorer?: IntentScorer; policy?: Partial<RoutingPolicy>; signal?: AbortSignal;
} = {}): Promise<RouteVerdict> {
  const scorer = opts.scorer ?? keywordScorer();
  const policy: RoutingPolicy = { ...DEFAULT_ROUTING_POLICY, ...opts.policy };
  const candidates: IntentCandidate[] = nodes.map((n) => ({ id: n.id, intent: n.does, examples: n.examples ?? [] }));
  if (candidates.length === 0) return { verdict: { kind: 'unmatched', ranked: [], decisive: false }, scorer: scorer.name, policy, nodes };
  try {
    const raw = await scorer.score({ message: phrase }, candidates, opts.signal);
    const scores = validateIntentScores(scorer.name, candidates, raw);
    return { verdict: decideTier2(scores, opts.incumbent, policy, scorer), scorer: scorer.name, policy, nodes };
  } catch {
    return { verdict: { kind: 'unmatched', ranked: [], decisive: false }, scorer: scorer.name, policy, nodes };
  }
}
